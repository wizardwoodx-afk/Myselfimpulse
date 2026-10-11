import React, { useEffect } from "react";
import { PRODUCT_NAME } from "../../brand";
import { useVh, type Screen } from "../store";
import { Steward } from "../screens/Steward";
import { Work } from "../screens/Work";
import { Specialists } from "../screens/Specialists";
import { Receipts } from "../screens/Receipts";
import Federation from "../screens/Federation";
import { Memory } from "../screens/Memory";
import { Docs } from "../screens/Docs";
import { Settings } from "../screens/Settings";
import Channels from "../screens/Channels";
import { Profile } from "../screens/Profile";
import { Chat } from "../screens/Chat";
import { GateCard } from "../screens/GateCard";
import { WindowControls } from "../WindowControls";
import { ErrorBoundary } from "../../panels/ErrorBoundary";
import { Toasts } from "../../panels/Toast";
import { AUTONOMY_MODES, modeForLevel, levelForMode, type AutonomyMode } from "../../engine/initiative";


/**
 * The door table. Declared once, in the exact shape the probe suites read, and
 * it is the single source for both the rail and the header title. The literal
 * shape is load-bearing: probe/navAlign.test.ts and probe/shellRender.test.tsx
 * DERIVE the expected door set from this file by regex rather than hardcoding
 * it, and probe/shellRender.test.tsx then asserts the count is exactly eight.
 * So the shape below must not be paraphrased — and no comment anywhere in this
 * file may contain a matching sample entry, or the count silently becomes nine.
 */
const NAV: Array<{ key: Screen; label: string; icon: string }> = [
  { key: "steward", label: "Captain", icon: "steward" },
  { key: "work", label: "Work", icon: "crew" },
  { key: "specialists", label: "Specialists", icon: "specialists" },
  { key: "channels", label: "Channels", icon: "channels" },
  { key: "federation", label: "Federation", icon: "federation" },
  { key: "receipts", label: "Receipts", icon: "receipts" },
  { key: "docs", label: "Docs", icon: "docs" },
  { key: "memory", label: "Memory", icon: "memory" },
  { key: "settings", label: "Settings", icon: "settings" },
];

/**
 * Presentation grouping over the door table. The eight doors and their order are
 * still owned entirely by NAV above — this only says which caption they sit under,
 * so the rail reads as two clusters instead of eight equal-weight rows. Keys are
 * references into NAV, never a second copy of the table.
 */
const NAV_GROUPS: Array<{ caption: string; keys: Screen[] }> = [
  { caption: "Mission", keys: ["steward", "work", "docs", "memory"] },
  { caption: "Records", keys: ["specialists", "channels", "federation", "receipts", "settings"] },
];

/** The conversation door is not in the rail; it is reached from inside Work. */
const CHAT_LABEL = "Conversation";

/** Each door gets its own boundary, so one bad screen cannot blank the shell. */

export function Shell(): React.ReactElement {
  const { screen, go, provider, busy, ownerHandle, boot, newMission, gate, stewardName, initiative, setAutonomy, savedTokens } = useVh();
  useEffect(() => { void boot(); }, [boot]);

  const current = NAV.find((n) => n.key === screen);
  /* Profile is reached from the rail footer, not the door table, so it has no
     NAV entry — and without this it took the product name as its heading,
     opening a screen called "SelfImpulse" inside an app called SelfImpulse. */
  const title = screen === "chat" ? CHAT_LABEL : current?.label ?? (screen === "profile" ? "Profile" : PRODUCT_NAME);

  /* The rail's one dial: the three modes an owner actually chooses — MANUAL
     (level 0, nothing runs unsent), SEMI-AUTONOMOUS (a schedule wakes the crew
     for safe, capped work), FIA (the crew self-schedules and adapts inside
     hard caps). Every mode reads `initiative.level`, so Settings, the
     composer's approval dial and this control cannot disagree. The gate is not
     on this dial: risky and critical work asks at every level. */
  const mode = modeForLevel(initiative.level);
  const pickMode = (want: AutonomyMode): void => {
    const level = levelForMode(want);
    if (level !== initiative.level) setAutonomy(level);
  };

  return (
    <div className="si-app">
      {/* The window is created with `decorations: false`, so the OS draws no
          title bar. Without these controls the application has no way to be
          closed, minimised or moved except a keyboard shortcut. It is mounted
          first so the controls paint above everything else. */}
      <WindowControls />

      {/* FIRST focusable element in the document. Off-screen until focused,
          then pinned top-left over the rail. */}
      <a className="si-skip" href="#main-content">Skip to content</a>

      <aside className="si-rail">
        {/* The brand, top-left, exactly as the mark was drawn: a wordmark on its
            own dark chip. The chip is deliberate so the white word reads on a
            light rail too — the artwork is white-on-black, and the black drops
            into the chip on either theme. */}
        <div className="si-brand">
          <img src="/brand/si-wordmark.png" alt="SelfImpulse" />
        </div>
        <div className="si-head">
          <div className="si-mode" role="group" aria-label="How much runs on its own">
            {AUTONOMY_MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                className="si-mode-btn"
                aria-pressed={mode === m.mode}
                title={`${m.label} — ${m.blurb}`}
                onClick={() => pickMode(m.mode)}
              >
                <span>{m.short}</span>
              </button>
            ))}
          </div>

          {/* The mission reset keeps its wiring and loses its sentence — the rail
              is 248px and the reset is one gesture, not a banner. */}
          <button className="si-new" onClick={newMission} aria-label="New mission" title="New mission">
            <i className="si-new-ic ic ic-plus" aria-hidden />
          </button>
        </div>

        <nav className="si-nav" aria-label="Primary">
          {NAV_GROUPS.map((g, gi) => {
            const capId = `si-nav-cap-${gi}`;
            return (
              <div key={g.caption} className="si-nav-grp" role="group" aria-labelledby={capId}>
                <b id={capId} className="si-nav-cap">{g.caption}</b>
                {NAV.filter((n) => g.keys.includes(n.key)).map((n) => {
                  const on = screen === n.key;
                  return (
                    <button
                      key={n.key}
                      className="si-nav-item"
                      onClick={() => go(n.key)}
                      aria-current={on ? "page" : undefined}
                    >
                      <i className={`si-nav-ic ic ic-${n.icon}`} aria-hidden />
                      <span className="si-nav-label">{n.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="si-foot">
          {/* Connection is the one thing down here that keeps words. A dot alone
              is a colour, and "no model" is a security fact: without a provider
              every run is a plan that executes nothing. So the dot, the glyph and
              a short state word all say it, and the title says the consequence. */}
          {/* The two attributes stay on one line: probe/navAlign greps this exact
              adjacency to prove the connection pill opens Settings and the owner
              avatar opens the profile. The wiring is the invariant; the literal is
              how it is caught. */}
          <button className="si-provider" onClick={() => go("settings")}
            aria-label={provider ? `Provider ${provider.model || provider.kind} — open settings` : "No model connected — every run is a plan that executes nothing. Open settings."}
            title={provider ? `${provider.kind} · ${provider.model || "no model named"}` : "no model connected — runs are plan only"}
          >
            <span className={`si-led ${provider ? "ok" : "warn"}`} aria-hidden />
            <i className="si-foot-ic si-g-plug" aria-hidden />
            <span className="si-provider-label">{provider ? provider.model || provider.kind : "No model"}</span>
          </button>
          <div className="si-foot-row">
            <button className="si-owner" onClick={() => go("profile")} aria-label={`Your profile — ${ownerHandle}`} title={ownerHandle}>
              <span className="si-av" aria-hidden>{initials(ownerHandle)}</span>
            </button>
            <span className="si-usage" title={`${savedTokens.toLocaleString()} tokens kept off the wire this session`}>
              <i className="si-foot-ic si-g-gauge" aria-hidden />
              {compact(savedTokens)}
            </span>
            <button className="si-foot-btn" onClick={() => go("docs")} aria-label="Docs — the knowledge and skill door" title="Docs">
              <i className="si-foot-ic ic ic-docs" aria-hidden />
            </button>
            <button className="si-foot-btn" onClick={() => go("settings")} aria-label="Settings" title="Settings">
              <i className="si-foot-ic ic ic-settings" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      {/* The gate stops the run and needs a human, so it must be reachable from
          every door — previously only Chat and Work mounted it, which let a
          heartbeat gate hang an unresolvable promise on the other eight. */}
      {gate && screen !== "chat" && screen !== "work" && (
        <div className="si-gate-overlay">
          <GateCard />
        </div>
      )}

      <div className="si-main-wrap">
        <header className="si-top">
          <h1>{title}</h1>
          <div className="si-chips">
            {busy ? <span className="si-chip">Working</span> : null}
          </div>
        </header>

        {/* The scroll region. #main-content + tabIndex={-1} is the skip
            link's target; without tabIndex the link would scroll the viewport
            but leave keyboard focus stranded up in the rail. */}
        <main className="si-main" id="main-content" tabIndex={-1}>
          <div className="si-scroll">
            <div className="si-content">
              {screen === "steward" && door("steward", <Steward />)}
              {screen === "work" && door("work", <Work />)}
              {screen === "specialists" && door("specialists", <Specialists />)}
              {screen === "federation" && door("federation", <Federation />)}
              {screen === "receipts" && door("receipts", <Receipts />)}
              {screen === "docs" && door("docs", <Docs />)}
              {screen === "memory" && door("memory", <Memory />)}
              {screen === "settings" && door("settings", <Settings />)}
      {screen === "channels" && door("channels", <Channels />)}
              {screen === "profile" && door("profile", <Profile />)}
              {screen === "chat" && (
                <ErrorBoundary label="Conversation" resetKey={screen} onLeave={() => go("steward")}>
                  <Chat title={stewardName} />
                </ErrorBoundary>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* The toast component renders a bare fixed container with no ARIA, and
          it is owned by another stream. Wrapping it here gives the whole
          region a polite live announcement without editing that file. */}
      <div className="si-toasts" role="status" aria-live="polite" aria-atomic="false">
        <Toasts />
      </div>
    </div>
  );
}

function initials(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "11";
}
/* The usage chip is 248px of rail, so a five-digit count is a number the eye
   cannot take in. The full count lives in its title. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
function door(key: Screen, el: React.ReactElement) {
  return (
    <ErrorBoundary label={NAV.find((n) => n.key === key)?.label ?? key} resetKey={key}>
      {el}
    </ErrorBoundary>
  );
}
