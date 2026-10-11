import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/channelDoors.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/engine/channelDoors.ts
var CHANNEL_KIND_BY_CONNECTOR = {
  slack: "slack",
  gmail: "email",
  telegram: "telegram",
  discord: "discord",
  whatsapp: "whatsapp",
  webchat: "webchat",
  a2a: "a2a"
};
function channelDoor(connector2) {
  const kind = CHANNEL_KIND_BY_CONNECTOR[connector2.id];
  if (!kind) return null;
  return { id: connector2.id, kind, enabled: false, access: { groupPolicy: "isolated", requireMention: true } };
}
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

// probe/channelDoors.test.ts
var connector = (over) => ({
  id: "slack",
  name: "Slack",
  vendor: "Salesforce",
  baseUrl: "https://slack.com/api",
  purpose: "reach the crew",
  scopes: ["channels:read"],
  authEnv: "HANDLE_SLACK_TOKEN",
  canMutate: true,
  binds: ["comms"],
  ...over
});
var DOORS = (() => {
  const door = channelDoor(connector({}));
  return [{ ...door, enabled: true, access: { allow: ["U1"], groupPolicy: "isolated", requireMention: true } }];
})();
var msg = (over) => ({
  door: "slack",
  chatId: "self",
  senderId: "U1",
  kind: "dm",
  text: "hi",
  at: Date.now(),
  ...over
});
test("a fresh door is OFF and admits no one (fail-closed)", () => {
  const fresh = channelDoor(connector({}));
  assert.equal(fresh.enabled, false);
  assert.deepEqual(fresh.access.allow, void 0);
  const v = authorizeDoor("A", msg({}), [fresh]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /not enabled/);
});
test("an allowed DM lands in the shared main session", () => {
  const v = authorizeDoor("A", msg({}), DOORS);
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.session, "si:A:slack:main");
});
test("a sender off the allow list is refused \u2014 empty allow would admit no one", () => {
  const off = authorizeDoor("A", msg({ senderId: "EVIL" }), DOORS);
  assert.equal(off.ok, false);
  if (!off.ok) assert.match(off.reason, /allow list/);
  const noneAllowed = authorizeDoor("A", msg({}), [{ ...DOORS[0], access: { allow: [], groupPolicy: "isolated", requireMention: true } }]);
  assert.equal(noneAllowed.ok, false);
});
test("a group needs a mention; a mentioned group is isolated per chat", () => {
  const silent = authorizeDoor("A", msg({ kind: "group", chatId: "C1", mentioned: false }), DOORS);
  assert.equal(silent.ok, false);
  if (!silent.ok) assert.match(silent.reason, /mention/);
  const addressed = authorizeDoor("A", msg({ kind: "group", chatId: "C1", mentioned: true }), DOORS);
  assert.equal(addressed.ok, true);
  if (addressed.ok) assert.equal(addressed.session, "si:A:slack:group:C1");
});
test("shared groups collapse to the shared session; a thread keeps its own lane", () => {
  const shared = DOORS.map((d) => ({ ...d, access: { ...d.access, groupPolicy: "shared" } }));
  const g = authorizeDoor("A", msg({ kind: "group", chatId: "C9", mentioned: true }), shared);
  assert.equal(g.ok, true);
  if (g.ok) assert.equal(g.session, "si:A:slack:main");
  assert.equal(sessionKeyFor("A", msg({ kind: "dm", threadId: "T1" })), "si:A:slack:thread:T1");
});
test("an undeclared door is refused by name", () => {
  const v = authorizeDoor("A", msg({ door: "nope" }), DOORS);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /no channel door/);
});
test("the door references a credential; it never carries a value", () => {
  const serialised = JSON.stringify(DOORS);
  assert.ok(!/xoxb|xapp|token|secret/i.test(serialised), "no credential value in the door");
});
