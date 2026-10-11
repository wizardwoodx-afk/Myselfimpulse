/**
 * probe/channelDoors.test.ts — SelfImpulse channel doors.
 *
 * Pins the three load-bearing promises the door makes: a door is OFF until
 * enabled (fail-closed), session routing is deterministic (DM shared, group
 * isolated, thread its own lane), and the door carries a credential BY
 * REFERENCE and never a value. The door decides WHO may speak BEFORE the
 * engine sees anything — it never adds a tool and never touches the gate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AppConnector } from "../src/engine/connectors";
import {
  authorizeDoor,
  channelDoor,
  sessionKeyFor,
  type ChannelDoor,
  type ChannelMessage,
} from "../src/engine/channelDoors";

const connector = (over: Partial<AppConnector>): AppConnector => ({
  id: "slack", name: "Slack", vendor: "Salesforce", baseUrl: "https://slack.com/api",
  purpose: "reach the crew", scopes: ["channels:read"], authEnv: "HANDLE_SLACK_TOKEN",
  canMutate: true, binds: ["comms"], ...over,
});

const DOORS: ChannelDoor[] = (() => {
  const door = channelDoor(connector({}))!;
  // The owner opened it, named one allowed sender, isolated groups, mention-gated.
  return [{ ...door, enabled: true, access: { allow: ["U1"], groupPolicy: "isolated", requireMention: true } }];
})();

const msg = (over: Partial<ChannelMessage>): ChannelMessage => ({
  door: "slack", chatId: "self", senderId: "U1", kind: "dm", text: "hi", at: Date.now(), ...over,
});

test("a fresh door is OFF and admits no one (fail-closed)", () => {
  const fresh = channelDoor(connector({}))!;
  assert.equal(fresh.enabled, false);
  assert.deepEqual(fresh.access.allow, undefined);
  const v = authorizeDoor("A", msg({}), [fresh]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /not enabled/);
});

test("an allowed DM lands in the shared main session", () => {
  const v = authorizeDoor("A", msg({}), DOORS);
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.session, "si:A:slack:main");
});

test("a sender off the allow list is refused — empty allow would admit no one", () => {
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
  const shared = DOORS.map((d) => ({ ...d, access: { ...d.access, groupPolicy: "shared" as const } }));
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
