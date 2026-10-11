import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/namespaces.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/engine/namespaces.ts
var ROOT_NAMESPACE = "ns.default";
function nsKey(namespace, kind, name) {
  return `si:${namespace}:${kind}:${name}`;
}
function canAccess(resourceNamespace, actorNamespace) {
  return resourceNamespace === actorNamespace;
}
var NamespaceRegistry = class {
  ns = /* @__PURE__ */ new Map();
  /** Idempotent: an existing namespace is returned untouched, never re-created. */
  ensure(id, owner, at) {
    const found = this.ns.get(id);
    if (found) return found;
    const created = { id, owner, createdAt: at };
    this.ns.set(id, created);
    return created;
  }
  get(id) {
    return this.ns.get(id) ?? null;
  }
  list() {
    return [...this.ns.values()];
  }
};

// probe/namespaces.test.ts
test("resource keys are namespaced and stable", () => {
  assert.equal(nsKey("ns.a", "seat", "coder"), "si:ns.a:seat:coder");
});
test("isolation fails closed \u2014 cross-namespace is refused", () => {
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
