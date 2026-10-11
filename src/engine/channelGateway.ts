/**
 * SelfImpulse — Channel gateway runtime.
 *
 * The live seam a message crosses on its way IN from a channel. A peer's words
 * arrive; the DOOR decides who may speak (channelDoors), the session is scoped
 * INSIDE the owner's namespace (namespaces — no cross-tenant bleed), the
 * delivery mode is resolved honestly (compute — a missing host is refused, not
 * faked), an admitted message may LAUNCH a preset crew (presets — rendered,
 * never invented), the crossing is appended to an immutable REVISION log
 * (revisions), and only then is the text handed to the ENGINE through an
 * injected DELIVER callback. This is where the ported OCE domains actually run
 * together; it touches no screen and no frozen authority — the messaging side
 * only. Provenance: docs/legal/THIRD-PARTY-NOTICES.md.
 */
import { authorizeDoor, type ChannelDoor, type ChannelMessage } from "./channelDoors";
import { resolveCompute, type ExecutionMode } from "./compute";
import { nsKey } from "./namespaces";
import { validatePreset, renderPreset, type Preset } from "./presets";
import { RevisionLog } from "./revisions";

export interface GatewayHandoff {
  session: string;
  text: string;
  senderId: string;
  door: string;
  compute: ExecutionMode;
  /** A rendered launch config, when the admitted message started a preset. */
  launch?: Record<string, string>;
}

export interface GatewayRequest {
  agentId: string;
  /** The namespace the delivery lands in (the owner's). Sessions are scoped here. */
  namespaceId: string;
  doors: ChannelDoor[];
  message: ChannelMessage;
  computeMode: ExecutionMode;
  /** Non-null only when a side-car host is live. */
  hostEndpoint: string | null;
  /** The engine seam: admitted text is handed here. */
  deliver: (handoff: GatewayHandoff) => void;
  /** Optional: an admitted message launches this preset crew. */
  preset?: Preset;
  presetValues?: Record<string, string>;
}

export type GatewayResult =
  | { ok: true; session: string; rev: number; compute: ExecutionMode; launch?: Record<string, string> }
  | { ok: false; reason: string };

interface Crossing { door: string; senderId: string; session: string }

export class ChannelGateway {
  private readonly history = new RevisionLog<Crossing>();

  /** Admit one inbound message and hand it to the engine — or refuse in words. */
  admit(req: GatewayRequest): GatewayResult {
    /* 1 · the door: who may speak, decided before anything else runs. */
    const door = authorizeDoor(req.agentId, req.message, req.doors);
    if (!door.ok) return { ok: false, reason: door.reason };

    /* 2 · an admitted message may start a preset crew — rendered honestly. */
    let launch: Record<string, string> | undefined;
    if (req.preset) {
      const issues = validatePreset(req.preset);
      if (issues.length > 0) return { ok: false, reason: `preset "${req.preset.id}" is not sound: ${issues[0]}` };
      const rendered = renderPreset(req.preset, req.presetValues ?? {});
      if (!rendered.ok) return { ok: false, reason: rendered.reason };
      launch = rendered.config;
    }

    /* 3 · compute: resolve the delivery mode; a missing host is refused. */
    const compute = resolveCompute(req.computeMode, req.hostEndpoint);
    if (!compute.ok) return { ok: false, reason: compute.reason };

    /* 4 · scope the session inside the owner's namespace, then snapshot it. */
    const session = nsKey(req.namespaceId, "session", door.session.replace(/^si:/, ""));
    const rev = this.history.commit({ door: req.message.door, senderId: req.message.senderId, session }, req.message.at);

    /* 5 · hand the admitted text to the engine. */
    req.deliver({
      session,
      text: req.message.text,
      senderId: req.message.senderId,
      door: req.message.door,
      compute: compute.target.mode,
      launch,
    });
    return { ok: true, session, rev, compute: compute.target.mode, launch };
  }

  /** The immutable record of what crossed each admitted door. */
  crossings(): readonly { rev: number; at: number; snapshot: Crossing }[] {
    return this.history.list();
  }
}
