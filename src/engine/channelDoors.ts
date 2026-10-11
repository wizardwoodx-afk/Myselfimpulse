/**
 * SelfImpulse — Channel doors.
 *
 * ORIGIN: adapted from an MIT-licensed open-source Gateway design. Its three
 * load-bearing ideas are carried over and rebuilt against SelfImpulse's own
 * rules — session routing, fail-closed door access control, and
 * credential-by-reference — with none of that project's runtime pulled in.
 * Source attribution and license are recorded in docs/legal/THIRD-PARTY-NOTICES.md.
 *
 * A CHANNEL DOOR is how a person reaches their Captain from wherever they
 * already live — Slack, Telegram, Discord, WhatsApp, mail, the web app, or a
 * peer Captain over A2A. One door, one declared policy, credential-by-reference.
 *
 * What this is NOT: it is not the agent, and it never becomes a new tool. A
 * door only decides WHO may speak to the crew and WHICH session their words
 * land in — then it hands the message to the SAME governed path a typed
 * message takes (gate, receipts, everything). A door that was not explicitly
 * allowed is refused, in words, BEFORE anything runs: the transport is
 * untrusted input, so the door fails closed.
 */
import type { AppConnector } from "./connectors";

/** Doors that carry a two-way conversation. `a2a` is a peer Captain over our own protocol. */
export type ChannelKind = "slack" | "telegram" | "discord" | "whatsapp" | "email" | "webchat" | "a2a";

/** Group chats: collapse into the shared session, or isolate per chat. */
export type GroupPolicy = "shared" | "isolated";

export interface ChannelAccess {
  /**
   * Sender ids allowed to reach this door. Empty/undefined means NONE — a door
   * with no allow list admits no one (fail-closed), it never means "everyone".
   */
  allow?: string[];
  groupPolicy: GroupPolicy;
  /** In a group chat, require the Captain to be addressed before the message is admitted. */
  requireMention: boolean;
}

export interface ChannelDoor {
  /** The connector id it rides — the token lives at that connector's authEnv, never here. */
  id: string;
  kind: ChannelKind;
  /** Off until the owner turns it on: a door that never said yes is closed. */
  enabled: boolean;
  access: ChannelAccess;
}

/** A normalised inbound message, whatever transport carried it. */
export interface ChannelMessage {
  door: string;
  /** Stable chat identifier (channel id, group id, or "self" for a DM). */
  chatId: string;
  senderId: string;
  kind: "dm" | "group";
  text: string;
  threadId?: string;
  /** In a group chat, was the Captain addressed. */
  mentioned?: boolean;
  at: number;
}

export type DoorVerdict =
  | { ok: true; session: string }
  | { ok: false; reason: string };

/* ── doors, declared from the connector registry (credential-by-reference) ── */

const CHANNEL_KIND_BY_CONNECTOR: Record<string, ChannelKind> = {
  slack: "slack",
  gmail: "email",
  telegram: "telegram",
  discord: "discord",
  whatsapp: "whatsapp",
  webchat: "webchat",
  a2a: "a2a",
};

/** True when this connector can carry a two-way conversation. */
export function isChannelConnector(c: AppConnector): boolean {
  return c.id in CHANNEL_KIND_BY_CONNECTOR;
}

/**
 * Build a door for a connector. A fresh door is DISABLED and admits no one —
 * connecting the key is one act, opening the door is another, and both are the
 * owner's to make. No token is stored here, ever.
 */
export function channelDoor(connector: AppConnector): ChannelDoor | null {
  const kind = CHANNEL_KIND_BY_CONNECTOR[connector.id];
  if (!kind) return null;
  return { id: connector.id, kind, enabled: false, access: { groupPolicy: "isolated", requireMention: true } };
}

/* ── session routing (deterministic keys, never guessed) ─────────────────── */

/**
 * The session a message belongs to. Direct -> one shared session (a DM thread
 * is a continuation, not a new room). Group -> isolated per chat, unless the
 * door chose to collapse groups into the shared session. A thread keeps its
 * own lane. Keys are stable so "continue that conversation" always resolves.
 */
export function sessionKeyFor(agentId: string, m: ChannelMessage, groupShared = false): string {
  const base = `si:${agentId}:${m.door}`;
  if (m.threadId) return `${base}:thread:${m.threadId}`;
  if (m.kind === "dm") return `${base}:main`;
  return groupShared ? `${base}:main` : `${base}:group:${m.chatId}`;
}

/* ── the door: who may speak, decided BEFORE the engine sees a byte ───────── */

export function authorizeDoor(agentId: string, m: ChannelMessage, doors: ChannelDoor[]): DoorVerdict {
  const door = doors.find((d) => d.id === m.door);
  if (!door) return { ok: false, reason: `no channel door "${m.door}" is declared` };
  if (!door.enabled) {
    return { ok: false, reason: `channel door "${m.door}" is not enabled — enable it before a peer can speak to the crew` };
  }
  const allow = door.access.allow;
  if (!allow || allow.length === 0) {
    return { ok: false, reason: `door "${m.door}" admits no one — name the senders who may speak (fail-closed)` };
  }
  if (!allow.includes(m.senderId)) {
    return { ok: false, reason: `sender "${m.senderId}" is not on door "${m.door}"'s allow list` };
  }
  if (m.kind === "group" && door.access.requireMention && !m.mentioned) {
    return { ok: false, reason: `group message without a mention — the door asks to be addressed` };
  }
  return { ok: true, session: sessionKeyFor(agentId, m, door.access.groupPolicy === "shared") };
}
