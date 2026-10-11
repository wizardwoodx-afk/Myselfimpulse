/**
 * SelfImpulse — Channel ingress (the inbound edge).
 *
 * The seam a channel transport calls. A raw payload arrives; the transport's
 * own AUTHENTICATOR proves the message is genuinely from the channel BEFORE the
 * bytes are trusted — no unauthenticated message ever reaches the crew
 * (fail-closed). Then the payload is NORMALISED into a SelfImpulse message and
 * handed to the ChannelGateway, which decides who may speak and delivers the
 * admitted text to the engine.
 *
 * This module is transport-agnostic and network-agnostic on purpose: a Slack or
 * Telegram adapter supplies (a) its authenticator — a channel-specific
 * signature check with a credential held BY REFERENCE — and (b) its normaliser.
 * This module enforces the ORDER and the rule: authenticate first, refuse an
 * unauthenticated payload in words without ever reading its body, and only then
 * open the door. Provenance: docs/legal/THIRD-PARTY-NOTICES.md.
 */
import { ChannelGateway, type GatewayRequest, type GatewayResult } from "./channelGateway";
import type { ChannelMessage } from "./channelDoors";

export interface IngressRequest<T> {
  /** The raw payload from the transport. */
  raw: T;
  /** Proves the payload is genuinely from the channel. False rejects before anything is read. */
  authenticate: (raw: T) => boolean;
  /** Turns an authenticated payload into a SelfImpulse message. */
  normalize: (raw: T) => ChannelMessage;
  /** Everything the gateway needs except the message, which the normaliser supplies. */
  gateway: Omit<GatewayRequest, "message">;
}

/** Authenticate → normalise → door → namespace → compute → revision → deliver. */
export function ingestThroughGateway<T>(gw: ChannelGateway, req: IngressRequest<T>): GatewayResult {
  if (!req.authenticate(req.raw)) {
    return { ok: false, reason: "ingress failed authentication — the payload is not trusted, so nothing was delivered and its body was never read" };
  }
  const message = req.normalize(req.raw);
  return gw.admit({ ...req.gateway, message });
}
