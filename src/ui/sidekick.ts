/**
 * THE SIDEKICK — a small companion that answers WHILE the big agent runs.
 *
 * The problem it solves: while a run is in flight the main agent is busy and the
 * human would otherwise have to type-and-wait, or steer a running mission by
 * interrupting it. The Sidekick is a separate, always-available voice: it talks
 * to the person in the meantime so a long run never feels like a locked door.
 *
 * HONESTY IS THE WHOLE DESIGN. The Sidekick has no model and no crew; it will
 * NOT fabricate an answer to a real question. It does the things a small
 * companion can do truthfully — acknowledge, give live status, hold a thought,
 * push small steering notes — and says plainly that the real answer comes from
 * the main agent, not from it. It is deterministic (probe-friendly) and touches
 * no network and no gate; it can never change what the run is doing.
 */
export interface SidekickContext {
  /** True while the main agent is mid-run. */
  running: boolean;
  /** What the run is currently working on, when the surface knows it. */
  subject?: string;
  /** The human-facing name of the main agent, so the reply can name it. */
  captainName?: string;
}

const clip = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * One deterministic reply to one typed message, in the operator's words. It
 * returns a sentence the person can read — never a guess dressed as an answer.
 */
export function sidekickReply(input: string, ctx: SidekickContext): string {
  const q = input.trim();
  const low = q.toLowerCase();
  const who = ctx.captainName && ctx.captainName.length > 0 ? ctx.captainName : "the agent";
  const onIt = ctx.subject && ctx.subject.length > 0 ? ` on “${clip(ctx.subject, 60)}”` : "";

  if (!low) {
    return `I'm here${ctx.running ? ` — ${who} is still working${onIt}` : ""}. Ask me anything while you wait.`;
  }
  if (/^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/.test(low)) {
    return `Hey — I'm your sidekick${ctx.running ? `, and ${who} is busy${onIt}` : ""}. I can give you a quick read on where things stand, or jot a note for when the run lands.`;
  }
  if (/(status|progress|where.*at|what.*doing|how.*going|how.*long|almost|done|finished)\b/.test(low)) {
    return ctx.running
      ? `Still running${onIt}. I don't have a live step counter to quote you, so I won't guess a percentage — the Work tab shows the real steps as they land, and the full answer comes through when it finishes.`
      : `Nothing is running right now. When you send a task, I'll keep you company and ${who} will bring back the answer.`;
  }
  if (/^(stop|wait|hold|pause|cancel|abort)\b/.test(low)) {
    return `Noted — but stopping a run isn't mine to do; that's the gate's call, and I won't pretend otherwise. If something risky is paused, you'll see the card and can decide there. Otherwise the run finishes on its own.`;
  }
  if (/(instead|change|actually|newer idea|revise|scratch that)\b/.test(low)) {
    return `Got it — I'll hold that as the next thing you want, and I'll keep it in front of ${who} so it's the first thing handled once this run wraps.`;
  }
  if (/(thank|thanks|thx|ty|appreciate)\b/.test(low)) {
    return `Anytime. ${ctx.running ? `Still working away — I'll stay right here.` : `I'm here whenever you need me.`}`;
  }
  if (low.endsWith("?")) {
    return `Good question — “${clip(q)}”. I'm only the small companion, so I won't fake an answer; once ${who} finishes, hand it that question and you'll get the real one. It's noted.`;
  }
  return `Got it — “${clip(q)}”. ${ctx.running ? `${who} is still working; I've kept your note on the line so it's front-of-mind when the run wraps up.` : `Ready when you are.`}`;
}
