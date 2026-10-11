import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/channelIngress.test.ts
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

// probe/channelIngress.test.ts
var DOORS = [
  { id: "slack", kind: "slack", enabled: true, access: { allow: ["U1"], groupPolicy: "isolated", requireMention: true } }
];
var RAW = { team: "T", event: { channel: "C1", user: "U1", text: "ship it" } };
var normalizeSlack = (raw) => ({
  door: "slack",
  chatId: raw.event.channel,
  senderId: raw.event.user,
  kind: "group",
  text: raw.event.text,
  mentioned: true,
  at: 1
});
var gatewayArgs = (deliver) => ({
  agentId: "A",
  namespaceId: "ns.default",
  doors: DOORS,
  computeMode: "in-process",
  hostEndpoint: null,
  deliver
});
test("an authenticated payload is normalised, gated and delivered", () => {
  const gw = new ChannelGateway();
  const seen = [];
  const r = ingestThroughGateway(gw, { raw: RAW, authenticate: () => true, normalize: normalizeSlack, gateway: gatewayArgs((h) => seen.push(h)) });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, "ship it");
});
test("a payload that fails authentication is refused BEFORE normalise (fail-closed)", () => {
  const gw = new ChannelGateway();
  let normalised = 0;
  const r = ingestThroughGateway(gw, {
    raw: RAW,
    authenticate: () => false,
    normalize: (x) => {
      normalised++;
      return normalizeSlack(x);
    },
    gateway: gatewayArgs(() => {
    })
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /authentication/);
  assert.equal(normalised, 0);
});
test("the door still governs an authenticated payload (off-allowlist refused)", () => {
  const gw = new ChannelGateway();
  const seen = [];
  const r = ingestThroughGateway(gw, {
    raw: { ...RAW, event: { ...RAW.event, user: "EVIL" } },
    authenticate: () => true,
    normalize: normalizeSlack,
    gateway: gatewayArgs((h) => seen.push(h))
  });
  assert.equal(r.ok, false);
  assert.equal(seen.length, 0);
});
