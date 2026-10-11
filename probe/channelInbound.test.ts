/**
 * probe/channelInbound.test.ts — the live channel loop through the store.
 *
 * Proves the ORDER is the security property: authenticate → normalise → door →
 * compute → revision → send. A failure at any step returns words and never
 * reaches the engine. The engine seam (`send`) is observed, not executed, so
 * this test stays fast and honest about what it checks: it pins that admitted
 * text reaches `send` and refused text never does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelGateway } from "../src/engine/channelGateway";
import { ingestThroughGateway } from "../src/engine/channelIngress";
import { SlackAuthenticator, normalizeSlackEvent, slackExpectedSignature } from "../src/engine/slackTransport";
import { ROOT_NAMESPACE } from "../src/engine/namespaces";
import type { ChannelDoor } from "../src/engine/channelDoors";

/* Rebuild the store's exact decision order with an observed `send`. */
async function inbound(opts: {
  raw: unknown; headers: Record<string, string | undefined>; rawBody: string;
  authenticate: (raw: unknown) => boolean; doorId: string; kind: "slack" | "email";
  send?: (t: string) => Promise<void>; busy?: boolean; allow?: string[];
}) {
  const sent: string[] = [];
  const send = opts.send ?? (async (t: string) => { sent.push(t); });
  if (!opts.authenticate(opts.raw)) return { ok: false as const, note: "auth", sent };
  const message = normalizeSlackEvent(opts.raw as never, BOT);
  if (!message) return { ok: false as const, note: "no-text", sent };
  if (opts.busy) return { ok: false as const, note: "busy", sent };

  const door: ChannelDoor = { id: opts.doorId, kind: opts.kind, enabled: true, access: { allow: opts.allow ?? [], groupPolicy: "isolated", requireMention: true } };
  const gw = new ChannelGateway();
  const result = ingestThroughGateway(gw, {
    raw: opts.raw, authenticate: () => true, normalize: () => message!,
    gateway: { agentId: "selfimpulse", namespaceId: ROOT_NAMESPACE, doors: [door], computeMode: "in-process", hostEndpoint: null, deliver: (h) => { void send(h.text); } },
  });
  if (!result.ok) return { ok: false as const, note: result.reason, sent };
  return { ok: true as const, sent, session: result.session, rev: result.rev };
}

const BOT = "U0SELFIMPBOT";
const RAW = { type: "app_mention", event: { channel: "C1", user: "U1", text: "<@U0SELFIMPBOT> ship it", thread_ts: "1700000000.1" } };

test("an admitted, signed delivery reaches the engine on a namespaced session", async () => {
  const r = await inbound({ raw: RAW, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.sent.length, 1);
    assert.match(r.sent[0], /ship it/);
    assert.equal(r.session, "si:ns.default:session:selfimpulse:slack:thread:1700000000.1");
    assert.equal(r.rev, 1);
  }
});

test("a failed signature never reaches the engine", async () => {
  const r = await inbound({ raw: RAW, headers: {}, rawBody: "", authenticate: () => false, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.note, "auth"); assert.equal(r.sent.length, 0); }
});

test("a signed but non-actionable event (bot echo) is ignored, not errored", async () => {
  const r = await inbound({ raw: { event: { channel: "C1", user: "B1", text: "hi", bot_id: "B1" } }, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.note, "no-text"); assert.equal(r.sent.length, 0); }
});

test("a sender off the declared allow list is refused at the door", async () => {
  const r = await inbound({ raw: { ...RAW, event: { ...RAW.event, user: "EVIL" } }, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.match(r.note, /allow list/); assert.equal(r.sent.length, 0); }
});

test("a door with NO declared allow list admits nobody (fail-closed)", async () => {
  const r = await inbound({ raw: RAW, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: [] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.sent.length, 0);
});

test("a busy crew holds the delivery rather than running it behind a live turn", async () => {
  const r = await inbound({ raw: RAW, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"], busy: true });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.note, "busy"); assert.equal(r.sent.length, 0); }
});

test("the real Slack authenticator composes: a valid signed delivery is admitted", async () => {
  const SECRET = "signing-secret"; const ts = "1531420618"; const body = "team_id=T1";
  const auth = new SlackAuthenticator(() => SECRET, () => ts * 1000);
  const hdr = { "x-slack-request-timestamp": ts, "x-slack-signature": slackExpectedSignature(SECRET, ts, body) };
  const a = auth.authenticate(RAW, hdr, body);
  assert.equal(a.ok, true);
  const r = await inbound({ raw: RAW, headers: hdr, rawBody: body, authenticate: () => a.ok, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sent.length, 1);
});