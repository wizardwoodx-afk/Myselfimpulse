import test from "node:test";
import assert from "node:assert/strict";
import { validatePreset, renderPreset, type Preset } from "../src/engine/presets";

const P: Preset = {
  id: "team.default", name: "Default crew", purpose: "A balanced crew for ordinary work.",
  template: { team: "team.{{id}}", seat: "coder/{{model}}" },
  vars: [
    { name: "id", required: true },
    { name: "model", required: true },
    { name: "note", required: false },
  ],
};

test("an undeclared placeholder in the template is caught", () => {
  const bad = { ...P, template: { a: "{{ghost}}" } };
  assert.ok(validatePreset(bad).some((i) => /undeclared/.test(i)));
});

test("a declared-but-unused variable is surfaced", () => {
  assert.ok(validatePreset(P).some((i) => /note.*never used/.test(i)));
});

test("a missing required variable is refused, never invented", () => {
  const r = renderPreset(P, { id: "x" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /required variable "model"/);
});

test("an unknown value is refused", () => {
  const r = renderPreset(P, { id: "x", model: "y", bogus: "z" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not a declared variable/);
});

test("a fully-filled preset renders cleanly", () => {
  const r = renderPreset(P, { id: "c", model: "hermes" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.config.team, "team.c");
    assert.equal(r.config.seat, "coder/hermes");
  }
});
