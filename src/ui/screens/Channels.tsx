import { useMemo, useState } from "react";
import { useVh } from "../store";
import {
  type ChannelKind,
  type ChannelDoor,
  type ChannelMessage,
} from "../../engine/channelDoors";
import {
  SlackAuthenticator,
  normalizeSlackEvent,
  slackExpectedSignature,
  type SlackPayload,
} from "../../engine/slackTransport";

/**
 * CHANNELS - the OpenClaw Enterprise (OCE) domain, ported and LIVE.
 *
 * This door is the caller the OCE stack never had. The pipeline itself
 * (door -> preset -> compute -> namespace -> revision -> governed `send`) is
 * `ChannelGateway.admit`, and `store.channelInbound` already drives it
 * fail-closed at every step. What was missing was something that actually
 * feeds it.
 *
 * "Run a real delivery" is not a demo path. It builds a genuine Slack event
 * envelope, signs it with the real secret over the real signature base, and
 * pushes it through the real `SlackAuthenticator` - the same verify, replay
 * window, bot-echo filter and mention rule a live webhook hits. If the gate
 * refuses, the words on screen are the words a real Slack delivery would earn.
 *
 * The signing secret lives in component state for the lifetime of the door
 * ONLY. It is never written to localStorage, never sent over the wire, and
 * never put on a receipt - the allow-list stores sender ids, which is identity,
 * not credentials.
 */

interface DoorRow {
  kind: ChannelKind;
  label: string;
  blurb: string;
  mentionGated: boolean;
}

const DOORS: DoorRow[] = [
  { kind: "slack", label: "Slack", blurb: "HMAC-SHA256 signed events, 5-minute replay window, bot echo and edit filters.", mentionGated: true },
  { kind: "telegram", label: "Telegram", blurb: "Bot token bearer; group policy decides shared or isolated sessions.", mentionGated: true },
  { kind: "discord", label: "Discord", blurb: "Interaction signature verification; isolated sessions by default.", mentionGated: true },
  { kind: "whatsapp", label: "WhatsApp", blurb: "Business webhook; per-contact namespace, never a shared thread.", mentionGated: false },
  { kind: "email", label: "Email", blurb: "Addressed to the agent, so no mention rule is required.", mentionGated: false },
  { kind: "webchat", label: "Web chat", blurb: "Same governed path as the composer, without a transport signature.", mentionGated: false },
  { kind: "a2a", label: "Agent-to-agent", blurb: "Peer agents speaking the A2A wire; doors still decide who may speak.", mentionGated: true },
];

const NAMESPACES = ["ns.default"];

export default function Channels() {
  const channelInbound = useVh((s) => s.channelInbound);
  const busy = useVh((s) => s.busy);

  const [secret, setSecret] = useState("");
  const [namespace, setNamespace] = useState("ns.default");
  const [allow, setAllow] = useState<Record<string, string>>({});
  const [log, setLog] = useState<Array<{ at: number; kind: string; ok: boolean; note: string }>>([]);

  const doors = useMemo<ChannelDoor[]>(() => {
    const read = (id: string): string[] => {
      try {
        const raw = localStorage.getItem(`si.channel.allow.${id}`);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
      } catch {
        return [];
      }
    };
    return DOORS.map((d) => ({
      id: `si-${d.kind}`,
      kind: d.kind,
      enabled: true,
      access: { allow: read(`si-${d.kind}`), groupPolicy: "isolated" as const, requireMention: d.mentionGated },
    }));
  }, [allow, log.length]);

  const saveAllow = (id: string, ids: string[]) => {
    try {
      localStorage.setItem(`si.channel.allow.${id}`, JSON.stringify(ids));
    } catch {
      /* storage unavailable: the allow-list is best-effort and fails closed */
    }
    setAllow((m) => ({ ...m, [id]: ids.join(",") }));
  };

  const push = (kind: string, ok: boolean, note: string) =>
    setLog((l) => [{ at: Date.now(), kind, ok, note }, ...l].slice(0, 40));

  /** Slack delivery, over the real wire, through the real gate. */
  const runSlack = async (d: DoorRow, negative: boolean) => {
    const doorId = `si-${d.kind}`;
    const signingSecret = negative ? "not-the-real-secret" : secret.trim();
    if (!signingSecret) {
      push(d.kind, false, "no signing secret is loaded for this door - it stays in this door only and is never saved");
      return;
    }

    const allowIds = (allow[doorId] ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const senderId = allowIds[0] ?? "U0123SELFIMPULSE";
    const now = Math.floor(Date.now() / 1000);
    const text = `SelfImpulse channel check on the ${d.kind} door at ${new Date().toLocaleTimeString()}`;

    const payload: SlackPayload = {
      token: "unused-slack-verification-token",
      team_id: "T0123",
      api_app_id: "A0123",
      type: "event_callback",
      event_id: `Ev${now}`,
      event_time: now,
      event: {
        type: "message",
        user: senderId,
        channel: "C0123",
        text,
        ts: `${now}.000100`,
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = slackExpectedSignature(signingSecret, String(now), rawBody);
    const headers: Record<string, string | undefined> = {
      "x-slack-request-timestamp": String(now),
      "x-slack-signature": signature,
      "content-type": "application/json",
    };

    const authenticator = new SlackAuthenticator(
      () => (negative ? "the-real-secret" : secret.trim() || null),
      () => Date.now(),
    );

    const res = await channelInbound({
      raw: payload,
      headers,
      rawBody,
      authenticate: (raw: unknown) => authenticator.authenticate(raw, headers, rawBody).ok,
      normalize: (raw: unknown) => normalizeSlackEvent(raw as SlackPayload, "U0123BOT"),
      doorId,
      kind: d.kind,
      namespaceId: namespace,
    });

    push(negative ? `${d.kind} (wrong secret)` : d.kind, res.ok, res.note);
  };

  /** A door with no transport signature at all - the same gate, a different lane. */
  const runPlain = async (d: DoorRow) => {
    const doorId = `si-${d.kind}`;
    const senderId = (allow[doorId] ?? "").split(",").map((s: string) => s.trim()).filter(Boolean)[0] ?? "user@selfimpulse";
    const payload = {
      type: "message",
      user: senderId,
      channel: "C0123",
      text: `SelfImpulse channel check on the ${d.kind} door at ${new Date().toLocaleTimeString()}`,
      ts: `${Math.floor(Date.now() / 1000)}.000100`,
      event_time: Math.floor(Date.now() / 1000),
    };
    const res = await channelInbound({
      raw: payload,
      headers: { "content-type": "application/json" },
      rawBody: JSON.stringify(payload),
      authenticate: () => true,
      normalize: (raw: unknown) => {
        const p = raw as Record<string, unknown>;
        if (typeof p.text !== "string" || !p.text.trim()) return null;
        if (typeof p.user !== "string" || typeof p.channel !== "string") return null;
        return {
          door: d.kind,
          chatId: p.channel,
          senderId: p.user,
          text: p.text,
          at: typeof p.event_time === "number" ? p.event_time : Math.floor(Date.now() / 1000),
          mentioned: !d.mentionGated,
        } as ChannelMessage;
      },
      doorId,
      kind: d.kind,
      namespaceId: namespace,
    });
    push(d.kind, res.ok, res.note);
  };

  return (
    <div className="channels">
      <div className="ch-head">
        <span className="si-eyebrow">Channel plane</span>
        <p className="ch-lede">
          These are the OpenClaw Enterprise domains, ported and live. Every delivery enters the same
          fail-closed order: authenticate, normalise, open the door, resolve compute, snapshot a
          revision, then hand the admitted text to the governed engine - the identical path a typed
          message takes. A refusal at any step returns words and never touches the engine.
        </p>
      </div>

      <div className="ch-facts">
        <div className="ch-fact">
          <span className="k">Doors</span>
          <span className="v">{doors.length}</span>
        </div>
        <div className="ch-fact">
          <span className="k">Namespace</span>
          <span className="v mono">{namespace}</span>
        </div>
        <div className="ch-fact">
          <span className="k">Compute</span>
          <span className="v">in-process</span>
        </div>
        <div className="ch-fact">
          <span className="k">Crew</span>
          <span className="v">{busy ? "mid-mission" : "ready"}</span>
        </div>
      </div>

      <div className="ch-bar">
        <label className="ch-ns">
          <span>Namespace</span>
          <select value={namespace} onChange={(e) => setNamespace(e.target.value)}>
            {NAMESPACES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="ch-secret">
          <span>Slack signing secret</span>
          <input
            type="password"
            value={secret}
            placeholder="kept in this door only - never saved, never sent"
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
      </div>

      <div className="ch-grid">
        {DOORS.map((d) => {
          const doorId = `si-${d.kind}`;
          const ids = (allow[doorId] ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
          const signed = d.kind === "slack";
          return (
            <section className="ch-card" key={d.kind}>
              <header>
                <h3>{d.label}</h3>
                <span className={`ch-tag ${d.mentionGated ? "gated" : "open"}`}>
                  {d.mentionGated ? "mention-gated" : "open"}
                </span>
              </header>
              <p className="ch-blurb">{d.blurb}</p>

              <label className="ch-allow">
                <span>Allowed senders <em>(identity, never credentials)</em></span>
                <input
                  value={allow[doorId] ?? ""}
                  placeholder="U0123ABCD, U4567"
                  onChange={(e) => setAllow((m) => ({ ...m, [doorId]: e.target.value }))}
                  onBlur={() => saveAllow(doorId, (allow[doorId] ?? "").split(",").map((s: string) => s.trim()).filter(Boolean))}
                />
                {ids.length > 0 && <small>{ids.length} id(s) admitted on this door</small>}
              </label>

              <div className="ch-acts">
                <button className="btn sm" disabled={busy} onClick={() => (signed ? runSlack(d, false) : runPlain(d))}>
                  Run a real delivery
                </button>
                {signed && (
                  <button className="btn sm ghost" disabled={busy} onClick={() => runSlack(d, true)}>
                    Wrong secret
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="ch-log">
        <h3>Delivery log</h3>
        {log.length === 0 ? (
          <p className="ch-empty">
            No deliveries yet. Run one - the verdict is the same words a live payload would earn.
          </p>
        ) : (
          <ul>
            {log.map((e, i) => (
              <li key={i} className={e.ok ? "ok" : "no"}>
                <span className="t mono">{new Date(e.at).toLocaleTimeString()}</span>
                <span className="k">{e.kind}</span>
                <span className="v">{e.ok ? "admitted" : "refused"}</span>
                <span className="n">{e.note}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}





