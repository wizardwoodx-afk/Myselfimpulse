import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompute } from "../src/engine/compute";

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
