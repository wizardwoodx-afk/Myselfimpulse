/**
 * SelfImpulse — Launch presets.
 *
 * ADAPTED from a third-party MIT control-plane's "Preset" idea: a reusable
 * launch template with declared variables. A concrete run is rendered by
 * FILLING the variables; an unfilled required variable, an unknown value, or a
 * placeholder left unfilled is REFUSED in words — never invented to close the
 * gap. Rebuilt SelfImpulse-owned — attribution in docs/legal/THIRD-PARTY-NOTICES.md.
 */
export interface PresetVar { name: string; required: boolean; hint?: string }

export interface Preset {
  id: string;
  name: string;
  /** One sentence of purpose, so a preset is reviewable. */
  purpose: string;
  /** Template strings; {{var}} is substituted from supplied values. */
  template: Record<string, string>;
  vars: PresetVar[];
}

/** Static, pre-render review: declared vars must be used; no undeclared placeholder rides in. */
export function validatePreset(p: Preset): string[] {
  const issues: string[] = [];
  const declared = new Set(p.vars.map((v) => v.name));
  for (const [key, value] of Object.entries(p.template)) {
    for (const u of usedVars(value)) {
      if (!declared.has(u)) issues.push(`template "${key}" uses undeclared var "{{${u}}}"`);
    }
  }
  for (const v of p.vars) {
    const used = Object.values(p.template).some((t) => t.includes(`{{${v.name}}}`));
    if (!used) issues.push(`declared var "${v.name}" is never used in the template`);
  }
  return issues;
}

export type RenderResult =
  | { ok: true; config: Record<string, string> }
  | { ok: false; reason: string };

/** Fill a template into a concrete config. A missing required var or unknown value is refused. */
export function renderPreset(p: Preset, values: Record<string, string>): RenderResult {
  const declared = new Set(p.vars.map((v) => v.name));
  for (const k of Object.keys(values)) {
    if (!declared.has(k)) return { ok: false, reason: `"${k}" is not a declared variable of preset "${p.id}"` };
  }
  for (const v of p.vars) {
    if (v.required && !String(values[v.name] ?? "").length) {
      return { ok: false, reason: `required variable "${v.name}" is not filled` };
    }
  }
  const config: Record<string, string> = {};
  for (const [key, tpl] of Object.entries(p.template)) {
    config[key] = tpl.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, name: string) => String(values[name] ?? ""));
  }
  const hole = Object.keys(config).find((k) => /\{\{.*\}\}/.test(config[k]));
  if (hole) return { ok: false, reason: `an unfilled placeholder remains in "${hole}" — the preset would ship a hole, so it is refused` };
  return { ok: true, config };
}

function usedVars(s: string): string[] {
  return [...s.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((m) => m[1]);
}
