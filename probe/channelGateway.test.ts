import test from "node:test";
import assert from "node:assert/strict";
import { ChannelGateway, type GatewayHandoff } from "../src/engine/channelGateway";
import type { ChannelDoor } from "../src/engine/channelDoors";
import type { Preset } from "../src/engine/presets";

const DOORS: ChannelDoor[] = [
  { id: "slack", kind: "slack", enabled: true, access: { allow: ["U1"], groupPolicy: "isolated", requireMention: true } },
];

const req = (over: {
  text?: string; senderId?: string; computeMode?: "in-process" | "host-process";
  hostEndpoint?: string | null; preset?: Preset; presetValues?: Record<string, string>;
} = {}) => ({
  agentId: "A",
  namespaceId: "ns.default",
  doors: DOORS,
  computeMode: over.computeMode ?? ("in-process" as const),
  hostEndpoint: over.hostEndpoint ?? null,
  message: { door: "slack", chatId: "self", senderId: over.senderId ?? "U1", kind: "dm" as const, text: over.text ?? "hi", at: 1 },
  preset: over.preset,
  presetValues: over.presetValues,
});

test("an admitted DM is delivered, namespaced, and snapshotted as revision 1", () => {
  const gw = new ChannelGateway();
  const seen: GatewayHandoff[] = [];
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
  const seen: GatewayHandoff[] = [];
  const r = gw.admit({ ...req({ senderId: "EVIL" }), deliver: (h) => seen.push(h) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /allow list/);
  assert.equal(seen.length, 0);
});

test("a requested host-process with no live host is refused, not faked", () => {
  const gw = new ChannelGateway();
  const seen: GatewayHandoff[] = [];
  const r = gw.admit({ ...req({ computeMode: "host-process", hostEndpoint: null }), deliver: (h) => seen.push(h) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no host process/);
  assert.equal(seen.length, 0);
});

test("an admitted message launches a preset crew (rendered, nothing invented)", () => {
  const gw = new ChannelGateway();
  const preset: Preset = { id: "team.x", name: "X", purpose: "p", template: { team: "team.{{id}}" }, vars: [{ name: "id", required: true }] };
  const r = gw.admit({ ...req({ preset, presetValues: { id: "c" } }), deliver: () => {} });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.launch, { team: "team.c" });
});

test("a launch with a missing required preset var is refused (no invented value)", () => {
  const gw = new ChannelGateway();
  const preset: Preset = { id: "team.x", name: "X", purpose: "p", template: { team: "team.{{id}}" }, vars: [{ name: "id", required: true }] };
  const r = gw.admit({ ...req({ preset, presetValues: {} }), deliver: () => {} });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /required variable "id"/);
});

test("crossings are an immutable, append-only record", () => {
  const gw = new ChannelGateway();
  gw.admit({ ...req({ text: "one" }), deliver: () => {} });
  gw.admit({ ...req({ text: "two" }), deliver: () => {} });
  const cross = gw.crossings();
  assert.equal(cross.length, 2);
  assert.equal(cross[0].rev, 1);
  assert.equal(cross[1].rev, 2);
});
