import test from "node:test";
import assert from "node:assert/strict";
import { canAccess, nsKey, NamespaceRegistry, ROOT_NAMESPACE } from "../src/engine/namespaces";

test("resource keys are namespaced and stable", () => {
  assert.equal(nsKey("ns.a", "seat", "coder"), "si:ns.a:seat:coder");
});

test("isolation fails closed — cross-namespace is refused", () => {
  assert.equal(canAccess("ns.a", "ns.a"), true);
  assert.equal(canAccess("ns.a", "ns.b"), false);
});

test("the registry is idempotent per id and keeps owners", () => {
  const reg = new NamespaceRegistry();
  const a1 = reg.ensure("ns.a", "User 1", 1);
  const a2 = reg.ensure("ns.a", "User 1", 2);
  assert.equal(a1, a2);
  assert.equal(a1.createdAt, 1);
  assert.equal(reg.get("ns.z"), null);
  reg.ensure(ROOT_NAMESPACE, "owner", 3);
  assert.equal(reg.list().length, 2);
});
