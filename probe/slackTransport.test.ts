import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  SlackAuthenticator, normalizeSlackEvent, slackExpectedSignature,
  slackSignatureBase, constantTimeEquals, SLACK_MAX_SKEW_MS,
} from "../src/engine/slackTransport";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1&team_domain=test";

/** Sign exactly the way Slack does, using node:crypto as the independent oracle. */
function slackSign(ts: string, body: string, secret = SECRET): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
}

test("the signature base matches Slack's documented format", () => {
  assert.equal(slackSignatureBase("1531420618", "body"), "v0:1531420618:body");
});

test("our pure HMAC matches node:crypto on a Slack request", () => {
  assert.equal(slackExpectedSignature(SECRET, "1531420618", BODY), slackSign("1531420618", BODY));
});

test("a correctly-signed, in-window request authenticates", () => {
  const now = 1_531_420_618_000;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const r = a.authenticate({}, { "x-slack-request-timestamp": "1531420618", "x-slack-signature": slackSign("1531420618", BODY) }, BODY);
  assert.equal(r.ok, true);
});

test("a tampered body or wrong secret fails the signature", () => {
  const now = 1_531_420_618_000;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const hdr = { "x-slack-request-timestamp": "1531420618", "x-slack-signature": slackSign("1531420618", BODY) };
  const r = a.authenticate({}, hdr, BODY + "&injected=1"); // body changed after signing
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /does not verify/);

  const wrong = new SlackAuthenticator(() => "not-the-secret", () => now);
  const r2 = wrong.authenticate({}, hdr, BODY);
  assert.equal(r2.ok, false);
});

test("an unsigned request is refused", () => {
  const a = new SlackAuthenticator(() => SECRET);
  const r = a.authenticate({}, {}, BODY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /unsigned/);
});

test("a stale timestamp (replay window) is refused", () => {
  const ts = "1531420618";
  const now = ts * 1000 + SLACK_MAX_SKEW_MS + 1000;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const r = a.authenticate({}, { "x-slack-request-timestamp": ts, "x-slack-signature": slackSign(ts, BODY) }, BODY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /out — outside/);
});

test("a replayed request is refused the second time", () => {
  const ts = "1531420618";
  const now = ts * 1000;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const hdr = { "x-slack-request-timestamp": ts, "x-slack-signature": slackSign(ts, BODY) };
  assert.equal(a.authenticate({}, hdr, BODY).ok, true);
  const second = a.authenticate({}, hdr, BODY);
  assert.equal(second.ok, false);
  if (!second.ok) assert.match(second.reason, /already spent/);
});

test("no configured secret keeps the door closed", () => {
  const ts = "1531420618";
  const a = new SlackAuthenticator(() => null, () => ts * 1000);
  const r = a.authenticate({}, { "x-slack-request-timestamp": ts, "x-slack-signature": slackSign(ts, BODY) }, BODY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no Slack signing secret/);
});

test("a real text event normalises; bot echo and edits are ignored", () => {
  const ev = { event: { channel: "C1", user: "U1", text: "  ship it  ", thread_ts: "1700000000.1" } };
  const m = normalizeSlackEvent(ev);
  assert.ok(m);
  assert.equal(m!.text, "ship it");
  assert.equal(m!.chatId, "C1");
  assert.equal(m!.senderId, "U1");
  assert.equal(m!.threadId, "1700000000.1");
  assert.equal(m!.door, "slack");

  assert.equal(normalizeSlackEvent({ event: { channel: "C1", user: "B1", text: "hi", bot_id: "B1" } }), null);
  assert.equal(normalizeSlackEvent({ event: { channel: "C1", user: "U1", text: "edited", subtype: "message_changed" } }), null);
  assert.equal(normalizeSlackEvent({ event: { channel: "C1", user: "U1", text: "   " } }), null);
});

test("constant-time compare is correct on lengths and content", () => {
  assert.equal(constantTimeEquals("abc", "abc"), true);
  assert.equal(constantTimeEquals("abc", "abd"), false);
  assert.equal(constantTimeEquals("abc", "abcd"), false);
});