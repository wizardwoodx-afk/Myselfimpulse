import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/slackTransport.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// src/engine/pureHash.ts
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
var rotr = (x, n) => (x >>> n | x << 32 - n) >>> 0;
var utf8 = (text) => new TextEncoder().encode(text);
function sha256Bytes(data) {
  const bitLen = data.length * 8;
  const padded = new Uint8Array((data.length + 8 >> 6 << 6) + 64);
  padded.set(data);
  padded[data.length] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  let h0 = 1779033703, h1 = 3144134277, h2 = 1013904242, h3 = 2773480762;
  let h4 = 1359893119, h5 = 2600822924, h6 = 528734635, h7 = 1541459225;
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = h + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
    h5 = h5 + f >>> 0;
    h6 = h6 + g >>> 0;
    h7 = h7 + h >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0);
  ov.setUint32(4, h1);
  ov.setUint32(8, h2);
  ov.setUint32(12, h3);
  ov.setUint32(16, h4);
  ov.setUint32(20, h5);
  ov.setUint32(24, h6);
  ov.setUint32(28, h7);
  return out;
}
var toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function pureHmacSha256(secret, text) {
  let key = utf8(secret);
  if (key.length > 64) key = sha256Bytes(key);
  const ipad = new Uint8Array(64).fill(54);
  const opad = new Uint8Array(64).fill(92);
  for (let i = 0; i < key.length; i++) {
    ipad[i] ^= key[i];
    opad[i] ^= key[i];
  }
  const inner = new Uint8Array(64 + utf8(text).length);
  inner.set(ipad);
  inner.set(utf8(text), 64);
  return toHex(sha256Bytes(new Uint8Array([...opad, ...sha256Bytes(inner)])));
}

// src/engine/slackTransport.ts
var SLACK_MAX_SKEW_MS = 5 * 60 * 1e3;
function slackSignatureBase(timestamp, rawBody) {
  return `v0:${timestamp}:${rawBody}`;
}
function slackExpectedSignature(signingSecret, timestamp, rawBody) {
  return `v0=${pureHmacSha256(signingSecret, slackSignatureBase(timestamp, rawBody))}`;
}
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
var SlackAuthenticator = class {
  constructor(secret, now = Date.now) {
    this.secret = secret;
    this.now = now;
  }
  seen = /* @__PURE__ */ new Map();
  /** `raw` is accepted so the authenticator matches the ingress contract; Slack's
   *  signature is over the RAW BODY, so the header pair alone decides. */
  authenticate(raw, headers, rawBody) {
    void raw;
    const ts = headers["x-slack-request-timestamp"];
    const sig = headers["x-slack-signature"];
    if (!ts || !sig) return { ok: false, reason: "ingress is unsigned \u2014 Slack always signs; an unsigned request is refused" };
    const stamp = Number(ts);
    if (!Number.isFinite(stamp)) return { ok: false, reason: `timestamp "${ts}" is not a number \u2014 refused` };
    const skew = Math.abs(this.now() - stamp * 1e3);
    if (skew > SLACK_MAX_SKEW_MS) {
      return { ok: false, reason: `request timestamp is ${Math.round(skew / 1e3)}s out \u2014 outside the 5-minute window, so it is refused` };
    }
    const secret = this.secret();
    if (!secret) return { ok: false, reason: "no Slack signing secret is configured \u2014 the door stays closed rather than admit unverified traffic" };
    if (!constantTimeEquals(sig, slackExpectedSignature(secret, ts, rawBody))) {
      return { ok: false, reason: "Slack signature does not verify \u2014 refused" };
    }
    if (this.seen.has(ts)) return { ok: false, reason: "this Slack timestamp was already spent \u2014 a replayed request is refused" };
    this.seen.set(ts, this.now());
    if (this.seen.size > 512) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== void 0) this.seen.delete(oldest);
    }
    return { ok: true };
  }
};
function normalizeSlackEvent(payload, botUserId) {
  const ev = payload.event ?? payload;
  if (ev.bot_id) return null;
  if (ev.subtype) return null;
  if (typeof ev.text !== "string" || !ev.text.trim()) return null;
  if (typeof ev.user !== "string" || typeof ev.channel !== "string") return null;
  const byEvent = payload.type === "app_mention";
  const byMarker = !!botUserId && ev.text.includes(`<@${botUserId}>`);
  return {
    door: "slack",
    chatId: ev.channel,
    senderId: ev.user,
    kind: "group",
    text: ev.text.trim(),
    threadId: typeof ev.thread_ts === "string" ? ev.thread_ts : void 0,
    mentioned: byEvent || byMarker,
    at: Date.now()
  };
}

// probe/slackTransport.test.ts
var SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
var BODY = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1&team_domain=test";
function slackSign(ts, body, secret = SECRET) {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
}
test("the signature base matches Slack's documented format", () => {
  assert.equal(slackSignatureBase("1531420618", "body"), "v0:1531420618:body");
});
test("our pure HMAC matches node:crypto on a Slack request", () => {
  assert.equal(slackExpectedSignature(SECRET, "1531420618", BODY), slackSign("1531420618", BODY));
});
test("a correctly-signed, in-window request authenticates", () => {
  const now = 1531420618e3;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const r = a.authenticate({}, { "x-slack-request-timestamp": "1531420618", "x-slack-signature": slackSign("1531420618", BODY) }, BODY);
  assert.equal(r.ok, true);
});
test("a tampered body or wrong secret fails the signature", () => {
  const now = 1531420618e3;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const hdr = { "x-slack-request-timestamp": "1531420618", "x-slack-signature": slackSign("1531420618", BODY) };
  const r = a.authenticate({}, hdr, BODY + "&injected=1");
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
  const now = ts * 1e3 + SLACK_MAX_SKEW_MS + 1e3;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const r = a.authenticate({}, { "x-slack-request-timestamp": ts, "x-slack-signature": slackSign(ts, BODY) }, BODY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /out — outside/);
});
test("a replayed request is refused the second time", () => {
  const ts = "1531420618";
  const now = ts * 1e3;
  const a = new SlackAuthenticator(() => SECRET, () => now);
  const hdr = { "x-slack-request-timestamp": ts, "x-slack-signature": slackSign(ts, BODY) };
  assert.equal(a.authenticate({}, hdr, BODY).ok, true);
  const second = a.authenticate({}, hdr, BODY);
  assert.equal(second.ok, false);
  if (!second.ok) assert.match(second.reason, /already spent/);
});
test("no configured secret keeps the door closed", () => {
  const ts = "1531420618";
  const a = new SlackAuthenticator(() => null, () => ts * 1e3);
  const r = a.authenticate({}, { "x-slack-request-timestamp": ts, "x-slack-signature": slackSign(ts, BODY) }, BODY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no Slack signing secret/);
});
test("a real text event normalises; bot echo and edits are ignored", () => {
  const ev = { event: { channel: "C1", user: "U1", text: "  ship it  ", thread_ts: "1700000000.1" } };
  const m = normalizeSlackEvent(ev);
  assert.ok(m);
  assert.equal(m.text, "ship it");
  assert.equal(m.chatId, "C1");
  assert.equal(m.senderId, "U1");
  assert.equal(m.threadId, "1700000000.1");
  assert.equal(m.door, "slack");
  assert.equal(normalizeSlackEvent({ event: { channel: "C1", user: "B1", text: "hi", bot_id: "B1" } }), null);
  assert.equal(normalizeSlackEvent({ event: { channel: "C1", user: "U1", text: "edited", subtype: "message_changed" } }), null);
  assert.equal(normalizeSlackEvent({ event: { channel: "C1", user: "U1", text: "   " } }), null);
});
test("constant-time compare is correct on lengths and content", () => {
  assert.equal(constantTimeEquals("abc", "abc"), true);
  assert.equal(constantTimeEquals("abc", "abd"), false);
  assert.equal(constantTimeEquals("abc", "abcd"), false);
});
