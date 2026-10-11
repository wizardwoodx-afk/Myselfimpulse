import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/channelInbound.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/engine/channelDoors.ts
function sessionKeyFor(agentId, m, groupShared = false) {
  const base = `si:${agentId}:${m.door}`;
  if (m.threadId) return `${base}:thread:${m.threadId}`;
  if (m.kind === "dm") return `${base}:main`;
  return groupShared ? `${base}:main` : `${base}:group:${m.chatId}`;
}
function authorizeDoor(agentId, m, doors) {
  const door = doors.find((d) => d.id === m.door);
  if (!door) return { ok: false, reason: `no channel door "${m.door}" is declared` };
  if (!door.enabled) {
    return { ok: false, reason: `channel door "${m.door}" is not enabled \u2014 enable it before a peer can speak to the crew` };
  }
  const allow = door.access.allow;
  if (!allow || allow.length === 0) {
    return { ok: false, reason: `door "${m.door}" admits no one \u2014 name the senders who may speak (fail-closed)` };
  }
  if (!allow.includes(m.senderId)) {
    return { ok: false, reason: `sender "${m.senderId}" is not on door "${m.door}"'s allow list` };
  }
  if (m.kind === "group" && door.access.requireMention && !m.mentioned) {
    return { ok: false, reason: `group message without a mention \u2014 the door asks to be addressed` };
  }
  return { ok: true, session: sessionKeyFor(agentId, m, door.access.groupPolicy === "shared") };
}

// src/engine/compute.ts
function resolveCompute(preferred, hostEndpoint) {
  if (preferred === "in-process") return { ok: true, target: { mode: "in-process" } };
  if (hostEndpoint && hostEndpoint.length > 0) {
    return { ok: true, target: { mode: "host-process", endpoint: hostEndpoint } };
  }
  return { ok: false, reason: "no host process is available on this machine \u2014 the seat refused rather than pretend to run on a host that is not there" };
}

// src/engine/namespaces.ts
var ROOT_NAMESPACE = "ns.default";
function nsKey(namespace, kind, name) {
  return `si:${namespace}:${kind}:${name}`;
}

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

// src/engine/revisions.ts
var RevisionLog = class {
  revs = [];
  active = 0;
  /** Append an immutable snapshot and activate it. Returns its id. */
  commit(snapshot, at, note) {
    const rev = this.revs.length + 1;
    this.revs.push({ rev, at, snapshot, note });
    this.active = rev;
    return rev;
  }
  /** The immutable snapshot that is live right now. */
  current() {
    return this.revs.find((r) => r.rev === this.active) ?? null;
  }
  activeRev() {
    return this.active;
  }
  list() {
    return [...this.revs];
  }
  get(rev) {
    return this.revs.find((r) => r.rev === rev) ?? null;
  }
  /** Point the running pointer at an existing snapshot. False for an unknown id (never faked). */
  setActive(rev) {
    if (!this.revs.some((r) => r.rev === rev)) return false;
    this.active = rev;
    return true;
  }
};

// src/engine/channelGateway.ts
var ChannelGateway = class {
  history = new RevisionLog();
  /** Admit one inbound message and hand it to the engine — or refuse in words. */
  admit(req) {
    const door = authorizeDoor(req.agentId, req.message, req.doors);
    if (!door.ok) return { ok: false, reason: door.reason };
    let launch;
    if (req.preset) {
      const issues = validatePreset(req.preset);
      if (issues.length > 0) return { ok: false, reason: `preset "${req.preset.id}" is not sound: ${issues[0]}` };
      const rendered = renderPreset(req.preset, req.presetValues ?? {});
      if (!rendered.ok) return { ok: false, reason: rendered.reason };
      launch = rendered.config;
    }
    const compute = resolveCompute(req.computeMode, req.hostEndpoint);
    if (!compute.ok) return { ok: false, reason: compute.reason };
    const session = nsKey(req.namespaceId, "session", door.session.replace(/^si:/, ""));
    const rev = this.history.commit({ door: req.message.door, senderId: req.message.senderId, session }, req.message.at);
    req.deliver({
      session,
      text: req.message.text,
      senderId: req.message.senderId,
      door: req.message.door,
      compute: compute.target.mode,
      launch
    });
    return { ok: true, session, rev, compute: compute.target.mode, launch };
  }
  /** The immutable record of what crossed each admitted door. */
  crossings() {
    return this.history.list();
  }
};

// src/engine/channelIngress.ts
function ingestThroughGateway(gw, req) {
  if (!req.authenticate(req.raw)) {
    return { ok: false, reason: "ingress failed authentication \u2014 the payload is not trusted, so nothing was delivered and its body was never read" };
  }
  const message = req.normalize(req.raw);
  return gw.admit({ ...req.gateway, message });
}

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

// probe/channelInbound.test.ts
async function inbound(opts) {
  const sent = [];
  const send = opts.send ?? (async (t) => {
    sent.push(t);
  });
  if (!opts.authenticate(opts.raw)) return { ok: false, note: "auth", sent };
  const message = normalizeSlackEvent(opts.raw, BOT);
  if (!message) return { ok: false, note: "no-text", sent };
  if (opts.busy) return { ok: false, note: "busy", sent };
  const door = { id: opts.doorId, kind: opts.kind, enabled: true, access: { allow: opts.allow ?? [], groupPolicy: "isolated", requireMention: true } };
  const gw = new ChannelGateway();
  const result = ingestThroughGateway(gw, {
    raw: opts.raw,
    authenticate: () => true,
    normalize: () => message,
    gateway: { agentId: "selfimpulse", namespaceId: ROOT_NAMESPACE, doors: [door], computeMode: "in-process", hostEndpoint: null, deliver: (h) => {
      void send(h.text);
    } }
  });
  if (!result.ok) return { ok: false, note: result.reason, sent };
  return { ok: true, sent, session: result.session, rev: result.rev };
}
var BOT = "U0SELFIMPBOT";
var RAW = { type: "app_mention", event: { channel: "C1", user: "U1", text: "<@U0SELFIMPBOT> ship it", thread_ts: "1700000000.1" } };
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
  if (!r.ok) {
    assert.equal(r.note, "auth");
    assert.equal(r.sent.length, 0);
  }
});
test("a signed but non-actionable event (bot echo) is ignored, not errored", async () => {
  const r = await inbound({ raw: { event: { channel: "C1", user: "B1", text: "hi", bot_id: "B1" } }, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.note, "no-text");
    assert.equal(r.sent.length, 0);
  }
});
test("a sender off the declared allow list is refused at the door", async () => {
  const r = await inbound({ raw: { ...RAW, event: { ...RAW.event, user: "EVIL" } }, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.note, /allow list/);
    assert.equal(r.sent.length, 0);
  }
});
test("a door with NO declared allow list admits nobody (fail-closed)", async () => {
  const r = await inbound({ raw: RAW, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: [] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.sent.length, 0);
});
test("a busy crew holds the delivery rather than running it behind a live turn", async () => {
  const r = await inbound({ raw: RAW, headers: {}, rawBody: "", authenticate: () => true, doorId: "slack", kind: "slack", allow: ["U1"], busy: true });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.note, "busy");
    assert.equal(r.sent.length, 0);
  }
});
test("the real Slack authenticator composes: a valid signed delivery is admitted", async () => {
  const SECRET = "signing-secret";
  const ts = "1531420618";
  const body = "team_id=T1";
  const auth = new SlackAuthenticator(() => SECRET, () => ts * 1e3);
  const hdr = { "x-slack-request-timestamp": ts, "x-slack-signature": slackExpectedSignature(SECRET, ts, body) };
  const a = auth.authenticate(RAW, hdr, body);
  assert.equal(a.ok, true);
  const r = await inbound({ raw: RAW, headers: hdr, rawBody: body, authenticate: () => a.ok, doorId: "slack", kind: "slack", allow: ["U1"] });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sent.length, 1);
});
