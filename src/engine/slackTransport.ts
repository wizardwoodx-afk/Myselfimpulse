/**
 * SelfImpulse — Slack channel transport (the adapter).
 *
 * An adapter supplies exactly two things to the ingress: an AUTHENTICATOR and
 * a NORMALISER. This one implements Slack's documented Events API:
 *
 *   1. Every request Slack sends carries `x-slack-request-timestamp` and
 *      `x-slack-signature: v0=<hex>`, where the hex is HMAC-SHA256 of
 *      "v0:<timestamp>:<rawBody>" under the app's SIGNING SECRET. The
 *      authenticator recomputes that and compares in constant time.
 *   2. A RECLAIM is refused: the same timestamp is only good once, and only
 *      inside a 5-minute window — so a captured request cannot be replayed to
 *      make the crew act twice.
 *   3. The normaliser turns a `message` (channel) or `app_mention` (DM-ish)
 *      event into a SelfImpulse message. Bot echoes, edits and non-text events
 *      are ignored rather than guessed at.
 *
 * The signing secret is used HELD BY REFERENCE — the owner names it, it is read
 * from the credential surface at call time, and it is never stored in a door, a
 * preset, or a receipt. Provenance: docs/legal/THIRD-PARTY-NOTICES.md.
 */
import { pureHmacSha256 } from "./pureHash";
import type { ChannelMessage } from "./channelDoors";

/** Slack rejects a signature whose timestamp is more than five minutes old. */
export const SLACK_MAX_SKEW_MS = 5 * 60 * 1000;

export interface SlackHeaders {
  "x-slack-request-timestamp"?: string;
  "x-slack-signature"?: string;
}

export type SlackEventEnvelope = {
  type?: string;
  channel?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  ts?: string;
  thread_ts?: string;
};

export type SlackPayload = {
  team_id?: string;
  event?: SlackEventEnvelope;
  /** Socket-mode deliveries carry the event at the top level instead. */
  [k: string]: unknown;
};

/** The signature base Slack signs: "v0:<timestamp>:<rawBody>". */
export function slackSignatureBase(timestamp: string, rawBody: string): string {
  return `v0:${timestamp}:${rawBody}`;
}

export function slackExpectedSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  return `v0=${pureHmacSha256(signingSecret, slackSignatureBase(timestamp, rawBody))}`;
}

/** Length-independent constant-time comparison — no early exit on the first byte. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SlackAuth =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Stateful verifier: remembers the timestamps it has already spent, so a
 * replayed request is refused on the SECOND delivery, not just by clock skew.
 * One instance per app secret.
 */
export class SlackAuthenticator {
  private readonly seen = new Map<string, number>();

  constructor(
    /** Read the signing secret from the credential surface at call time — never store it. */
    private readonly secret: () => string | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** `raw` is accepted so the authenticator matches the ingress contract; Slack's
   *  signature is over the RAW BODY, so the header pair alone decides. */
  authenticate(raw: unknown, headers: SlackHeaders, rawBody: string): SlackAuth {
    void raw;
    const ts = headers["x-slack-request-timestamp"];
    const sig = headers["x-slack-signature"];
    if (!ts || !sig) return { ok: false, reason: "ingress is unsigned — Slack always signs; an unsigned request is refused" };
    const stamp = Number(ts);
    if (!Number.isFinite(stamp)) return { ok: false, reason: `timestamp "${ts}" is not a number — refused` };

    const skew = Math.abs(this.now() - stamp * 1000);
    if (skew > SLACK_MAX_SKEW_MS) {
      return { ok: false, reason: `request timestamp is ${Math.round(skew / 1000)}s out — outside the 5-minute window, so it is refused` };
    }

    const secret = this.secret();
    if (!secret) return { ok: false, reason: "no Slack signing secret is configured — the door stays closed rather than admit unverified traffic" };
    if (!constantTimeEquals(sig, slackExpectedSignature(secret, ts, rawBody))) {
      return { ok: false, reason: "Slack signature does not verify — refused" };
    }

    if (this.seen.has(ts)) return { ok: false, reason: "this Slack timestamp was already spent — a replayed request is refused" };
    this.seen.set(ts, this.now());
    if (this.seen.size > 512) {
      // Bounded memory: drop the oldest spent timestamps. Skew already bounds
      // how long a timestamp could still be useful.
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return { ok: true };
  }
}

/**
 * Normalise a Slack delivery. Returns null for anything we deliberately do not
 * act on — bot echoes, edits, joins, and other non-text events — so the caller
 * treats "no message" as "nothing to do", never as an error.
 *
 * `botUserId` is the bot's own Slack user id, supplied by the owner at wiring
 * time. A channel message is only `mentioned` when the bot was actually
 * addressed — either the delivery is an `app_mention` event, or the text carries
 * Slack's `<@U…>` mention marker for us. This is what lets the door's
 * mention-gate admit an addressed message and refuse an ambient one.
 */
export function normalizeSlackEvent(payload: SlackPayload, botUserId?: string): ChannelMessage | null {
  const ev = (payload.event ?? payload) as SlackEventEnvelope;
  if (ev.bot_id) return null;                       // our own echo
  if (ev.subtype) return null;                      // edits, joins, and friends
  if (typeof ev.text !== "string" || !ev.text.trim()) return null;
  if (typeof ev.user !== "string" || typeof ev.channel !== "string") return null;

  const byEvent = payload.type === "app_mention";
  const byMarker = !!botUserId && ev.text.includes(`<@${botUserId}>`);

  // app_mention arrives with a channel too; we treat both as a group message
  // and let the DOOR decide whether a mention was present.
  return {
    door: "slack",
    chatId: ev.channel,
    senderId: ev.user,
    kind: "group",
    text: ev.text.trim(),
    threadId: typeof ev.thread_ts === "string" ? ev.thread_ts : undefined,
    mentioned: byEvent || byMarker,
    at: Date.now(),
  };
}