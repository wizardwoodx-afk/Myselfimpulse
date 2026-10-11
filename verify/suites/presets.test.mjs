import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/presets.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/engine/presets.ts
function validatePreset(p) {
  const issues = [];
  const declared = new Set(p.vars.map((v) => v.name));
  for (const [key, value] of Object.entries(p.template)) {
    for (const u of usedVars(value)) {
      if (!declared.has(u)) issues.push(`template "${key}" uses undeclared var "{{${u}}}"`);
    }
  }
  for (const v of p.vars) {
    const used = Object.values(p.template).some((t) => t.includes(`{{${v.name}}}`));
    if (!used) issues.push(`declared var "${v.name}" is never used in the template`);
  }
  return issues;
}
function renderPreset(p, values) {
  const declared = new Set(p.vars.map((v) => v.name));
  for (const k of Object.keys(values)) {
    if (!declared.has(k)) return { ok: false, reason: `"${k}" is not a declared variable of preset "${p.id}"` };
  }
  for (const v of p.vars) {
    if (v.required && !String(values[v.name] ?? "").length) {
      return { ok: false, reason: `required variable "${v.name}" is not filled` };
    }
  }
  const config = {};
  for (const [key, tpl] of Object.entries(p.template)) {
    config[key] = tpl.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, name) => String(values[name] ?? ""));
  }
  const hole = Object.keys(config).find((k) => /\{\{.*\}\}/.test(config[k]));
  if (hole) return { ok: false, reason: `an unfilled placeholder remains in "${hole}" \u2014 the preset would ship a hole, so it is refused` };
  return { ok: true, config };
}
function usedVars(s) {
  return [...s.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((m) => m[1]);
}

// probe/presets.test.ts
var P = {
  id: "team.default",
  name: "Default crew",
  purpose: "A balanced crew for ordinary work.",
  template: { team: "team.{{id}}", seat: "coder/{{model}}" },
  vars: [
    { name: "id", required: true },
    { name: "model", required: true },
    { name: "note", required: false }
  ]
};
test("an undeclared placeholder in the template is caught", () => {
  const bad = { ...P, template: { a: "{{ghost}}" } };
  assert.ok(validatePreset(bad).some((i) => /undeclared/.test(i)));
});
test("a declared-but-unused variable is surfaced", () => {
  assert.ok(validatePreset(P).some((i) => /note.*never used/.test(i)));
});
test("a missing required variable is refused, never invented", () => {
  const r = renderPreset(P, { id: "x" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /required variable "model"/);
});
test("an unknown value is refused", () => {
  const r = renderPreset(P, { id: "x", model: "y", bogus: "z" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not a declared variable/);
});
test("a fully-filled preset renders cleanly", () => {
  const r = renderPreset(P, { id: "c", model: "hermes" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.config.team, "team.c");
    assert.equal(r.config.seat, "coder/hermes");
  }
});
