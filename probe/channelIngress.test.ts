import test from "node:test";
import assert from "node:assert/strict";
import { ChannelGateway, type GatewayHandoff } from "../src/engine/channelGateway";
import { ingestThroughGateway } from "../src/engine/channelIngress";
import type { ChannelDoor, ChannelMessage } from "../src/engine/channelDoors";

const DOORS: ChannelDoor[] = [
  { id: "slack", kind: "slack", enabled: true, access: { allow: ["U1"], groupPolicy: "isolated", requireMention: true } },
];

// A believable raw payload a Slack transport would hand over.
const RAW = { team: "T", event: { channel: "C1", user: "U1", text: "ship it" } };
const normalizeSlack = (raw: typeof RAW): ChannelMessage => ({
  door: "slack", chatId: raw.event.channel, senderId: raw.event.user, kind: "group", text: raw.event.text, mentioned: true, at: 1,
});

const gatewayArgs = (deliver: (h: GatewayHandoff) => void) => ({
  agentId: "A", namespaceId: "ns.default", doors: DOORS, computeMode: "in-process" as const, hostEndpoint: null, deliver,
});

test("an authenticated payload is normalised, gated and delivered", () => {
  const gw = new ChannelGateway();
  const seen: GatewayHandoff[] = [];
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
    normalize: (x: typeof RAW) => { normalised++; return normalizeSlack(x); },
    gateway: gatewayArgs(() => {}),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /authentication/);
  assert.equal(normalised, 0); // the body was never even read
});

test("the door still governs an authenticated payload (off-allowlist refused)", () => {
  const gw = new ChannelGateway();
  const seen: GatewayHandoff[] = [];
  const r = ingestThroughGateway(gw, {
    raw: { ...RAW, event: { ...RAW.event, user: "EVIL" } },
    authenticate: () => true,
    normalize: normalizeSlack,
    gateway: gatewayArgs((h) => seen.push(h)),
  });
  assert.equal(r.ok, false);
  assert.equal(seen.length, 0);
});
