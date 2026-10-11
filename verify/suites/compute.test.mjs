import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/compute.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/engine/compute.ts
function resolveCompute(preferred, hostEndpoint) {
  if (preferred === "in-process") return { ok: true, target: { mode: "in-process" } };
  if (hostEndpoint && hostEndpoint.length > 0) {
    return { ok: true, target: { mode: "host-process", endpoint: hostEndpoint } };
  }
  return { ok: false, reason: "no host process is available on this machine \u2014 the seat refused rather than pretend to run on a host that is not there" };
}

// probe/compute.test.ts
test("in-process is always available", () => {
  const d = resolveCompute("in-process", null);
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.target.mode, "in-process");
});
test("host-process runs only when a host is live", () => {
  const d = resolveCompute("host-process", "http://127.0.0.1:8642");
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.target.mode, "host-process");
    assert.equal(d.target.endpoint, "http://127.0.0.1:8642");
  }
});
test("a missing host is refused in words, never faked", () => {
  const d = resolveCompute("host-process", null);
  assert.equal(d.ok, false);
  if (!d.ok) assert.match(d.reason, /no host process/);
});
