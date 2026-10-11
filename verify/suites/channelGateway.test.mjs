import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/channelGateway.test.ts
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
  admit(req2) {
    const door = authorizeDoor(req2.agentId, req2.message, req2.doors);
    if (!door.ok) return { ok: false, reason: door.reason };
    let launch;
    if (req2.preset) {
      const issues = validatePreset(req2.preset);
      if (issues.length > 0) return { ok: false, reason: `preset "${req2.preset.id}" is not sound: ${issues[0]}` };
      const rendered = renderPreset(req2.preset, req2.presetValues ?? {});
      if (!rendered.ok) return { ok: false, reason: rendered.reason };
      launch = rendered.config;
    }
    const compute = resolveCompute(req2.computeMode, req2.hostEndpoint);
    if (!compute.ok) return { ok: false, reason: compute.reason };
    const session = nsKey(req2.namespaceId, "session", door.session.replace(/^si:/, ""));
    const rev = this.history.commit({ door: req2.message.door, senderId: req2.message.senderId, session }, req2.message.at);
    req2.deliver({
      session,
      text: req2.message.text,
      senderId: req2.message.senderId,
      door: req2.message.door,
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

// probe/channelGateway.test.ts
var DOORS = [
  { id: "slack", kind: "slack", enabled: true, access: { allow: ["U1"], groupPolicy: "isolated", requireMention: true } }
];
var req = (over = {}) => ({
  agentId: "A",
  namespaceId: "ns.default",
  doors: DOORS,
  computeMode: over.computeMode ?? "in-process",
  hostEndpoint: over.hostEndpoint ?? null,
  message: { door: "slack", chatId: "self", senderId: over.senderId ?? "U1", kind: "dm", text: over.text ?? "hi", at: 1 },
  preset: over.preset,
  presetValues: over.presetValues
});
test("an admitted DM is delivered, namespaced, and snapshotted as revision 1", () => {
  const gw = new ChannelGateway();
  const seen = [];
  const r = gw.admit({ ...req(), deliver: (h) => seen.push(h) });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.session, "si:ns.default:session:A:slack:main");
    assert.equal(r.rev, 1);
    assert.equal(r.compute, "in-process");
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, "hi");
  assert.equal(gw.crossings().length, 1);
});
test("the door refuses before the engine sees anything (no delivery)", () => {
  const gw = new ChannelGateway();
  const seen = [];
  const r = gw.admit({ ...req({ senderId: "EVIL" }), deliver: (h) => seen.push(h) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /allow list/);
  assert.equal(seen.length, 0);
});
test("a requested host-process with no live host is refused, not faked", () => {
  const gw = new ChannelGateway();
  const seen = [];
  const r = gw.admit({ ...req({ computeMode: "host-process", hostEndpoint: null }), deliver: (h) => seen.push(h) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no host process/);
  assert.equal(seen.length, 0);
});
test("an admitted message launches a preset crew (rendered, nothing invented)", () => {
  const gw = new ChannelGateway();
  const preset = { id: "team.x", name: "X", purpose: "p", template: { team: "team.{{id}}" }, vars: [{ name: "id", required: true }] };
  const r = gw.admit({ ...req({ preset, presetValues: { id: "c" } }), deliver: () => {
  } });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.launch, { team: "team.c" });
});
test("a launch with a missing required preset var is refused (no invented value)", () => {
  const gw = new ChannelGateway();
  const preset = { id: "team.x", name: "X", purpose: "p", template: { team: "team.{{id}}" }, vars: [{ name: "id", required: true }] };
  const r = gw.admit({ ...req({ preset, presetValues: {} }), deliver: () => {
  } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /required variable "id"/);
});
test("crossings are an immutable, append-only record", () => {
  const gw = new ChannelGateway();
  gw.admit({ ...req({ text: "one" }), deliver: () => {
  } });
  gw.admit({ ...req({ text: "two" }), deliver: () => {
  } });
  const cross = gw.crossings();
  assert.equal(cross.length, 2);
  assert.equal(cross[0].rev, 1);
  assert.equal(cross[1].rev, 2);
});
