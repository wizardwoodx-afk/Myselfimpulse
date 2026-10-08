/**
 * Real artefacts, not fixtures — pushes files that actually exist on this machine
 * through the same door the Docs screen uses, plus a ZIP assembled from real repo
 * files. Where the rest of the suite proves the parsers with authored bytes, this
 * proves the door with messy, large, producer-made ones.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { configurePdfWorker } from "../src/mission/documentParsers";
import { createIngestRun, ingestFile, INGEST_LIMITS } from "../src/mission/fileIngest";

declare const SI_ROOT: string | undefined;
const ROOT = typeof SI_ROOT === "string" && SI_ROOT.length > 0 ? SI_ROOT : process.cwd();
configurePdfWorker(pathToFileURL(path.resolve(ROOT, "vendor", "pdfjs", "pdf.worker.min.mjs")).href);

const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
} as Storage;

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}
function section(name: string): void { console.log(`\n== ${name}`); }

const words = (r: Awaited<ReturnType<typeof ingestFile>>) =>
  r.ok ? r.content.slice(0, 160) : r.refusal.words;

async function file(name: string, rel: string) {
  return { name, bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, rel))) };
}

/* ── A portable PDF with a real text layer ────────────────────────────────────────
 * Built here, byte by byte, with a computed cross-reference table, so both readers
 * (pdf.js for the text layer, the WASM renderer for pages) accept it on any machine.
 * This suite used to read the author's own Downloads folder, which made it pass on
 * exactly one computer and fail on every other with a "missing file" line. A test that names
 * a personal path is not evidence, and a person's name does not belong in the tree. */
function buildPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/([\\()])/g, "\\$1");
  const body = lines.map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `0 -16 Td (${esc(l)}) Tj`)).join("\n");
  const stream = `BT /F1 12 Tf 72 720 Td\n${body}\nET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function main(): Promise<void> {
  section("0. what is actually on this machine");
  const real = ["demo/Synthetic-Industrial-FY26-RAW.xlsx", "demo/Synthetic-Industrial-FY26-CLASSIFIED.xlsx",
    "docs/legal/THIRD-PARTY-NOTICES.md", "public/ocr/tessdata/eng.traineddata"];
  const present = real.filter((r) => fs.existsSync(path.join(ROOT, r)));
  ok(`found ${present.length}/${real.length} real artefacts to feed the door`, present.length >= 2, present.join(", "));

  section("1. a real 2.8 MB workbook from a spreadsheet producer");
  const raw = await ingestFile(createIngestRun(INGEST_LIMITS), await file("Synthetic-Industrial-FY26-RAW.xlsx", "demo/Synthetic-Industrial-FY26-RAW.xlsx"));
  ok("the real workbook ingests", raw.ok === true, words(raw));
  ok("…and carries named sheets, not a blob", raw.ok && /## Sheet: \S/.test(raw.content), raw.ok ? "" : words(raw));
  ok("…and reports the columns it found", raw.ok && /Columns \(\d+\):/.test(raw.content), raw.ok ? "" : words(raw));

  section("2. the 4.3 MB classified workbook");
  const cls = await ingestFile(createIngestRun(INGEST_LIMITS), await file("Synthetic-Industrial-FY26-CLASSIFIED.xlsx", "demo/Synthetic-Industrial-FY26-CLASSIFIED.xlsx"));
  ok("the larger workbook ingests too", cls.ok === true, words(cls));
  ok("…and the char cap is stated rather than silently truncating", cls.ok && cls.content.length <= INGEST_LIMITS.maxParsedChars, cls.ok ? `${cls.content.length} chars` : "");

  section("3. a real ZIP assembled from real repo files");
  const zip = new JSZip();
  zip.file("README.md", fs.readFileSync(path.join(ROOT, "docs/legal/THIRD-PARTY-NOTICES.md"), "utf8"));
  zip.file("notes/lead-times.csv", "part,lead_days,vendor\nA-100,12,Northline\nB-77,5,Kestrel\n");
  zip.file("notes/deep/deep2/policy.md", "# Recourse\n\nNever check a grant after the gate has been consumed.\n");
  const zipBytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const zin = await ingestFile(createIngestRun(INGEST_LIMITS), { name: "vendor-pack.zip", bytes: zipBytes });
  ok("the zip expands and ingests", zin.ok === true, words(zin));
  ok("…and a file from the nested folder reaches the markdown", zin.ok && /Never check a grant/.test(zin.content), zin.ok ? "" : words(zin));
  ok("…and the CSV rows survive as content", zin.ok && /A-100/.test(zin.content) && /Kestrel/.test(zin.content), zin.ok ? "" : words(zin));

  section("4. a second run of the same bytes is stable");
  const again = await ingestFile(createIngestRun(INGEST_LIMITS), await file("Synthetic-Industrial-FY26-RAW.xlsx", "demo/Synthetic-Industrial-FY26-RAW.xlsx"));
  ok("identical bytes, identical markdown", raw.ok && again.ok && raw.content === again.content);

  section("5. a pre-2007 file is refused IN WORDS, not by crashing");
  const ole = await ingestFile(createIngestRun(INGEST_LIMITS), { name: "legacy.doc", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]) });
  ok("the OLE header is recognised and refused politely", ole.ok === false && /modern format|\.docx/.test(ole.refusal.words), ole.ok ? "it accepted a fake .doc" : ole.refusal.words);

  section("6. an operator-style PDF, built on this machine");
  const report = buildPdf([
    "INVOICE 2026-Q3",
    "Vendor: Northline Industrial",
    "Total: 48200 INR",
    "Reconcile against ledger AC-2201 before release.",
    "Lead times: A-100 twelve days, B-77 five days.",
    "Approved by: operations desk",
  ]);
  const reportIn = await ingestFile(createIngestRun(INGEST_LIMITS), { name: "quarterly-report.pdf", bytes: report });
  ok("a born-digital PDF ingests", reportIn.ok === true, words(reportIn));
  if (reportIn.ok) {
    ok("…and produced real prose, not a stub", reportIn.content.length > 150, `${reportIn.content.length} chars`);
    ok("…and the text layer is what was read", /ledger AC-2201/.test(reportIn.content), reportIn.content.slice(0, 120));
  }
  const blank = await ingestFile(createIngestRun(INGEST_LIMITS), { name: "blank.pdf", bytes: new Uint8Array(0) });
  ok("a 0-byte PDF is refused", blank.ok === false, words(blank));
  ok("…and the refusal names the emptiness, not the format", blank.ok === false && /0 bytes|empty/i.test(blank.refusal.words), blank.ok ? "" : blank.refusal.words);

  console.log(`\n${"=".repeat(40)}\nREAL-ARTEFACT DOOR: ${passed} passed, ${failed} failed.\n${"=".repeat(40)}`);
  if (failed > 0) process.exitCode = 1;
}

void main();
