/**
 * SelfImpulse — Namespaces (tenant and resource isolation).
 *
 * ADAPTED from a third-party MIT control-plane's "Namespace" idea: every
 * resource is scoped to a namespace, and access is decided by namespace
 * identity. Isolation FAILS CLOSED — a caller in one namespace cannot touch a
 * resource in another unless an explicit crossing is granted, and that grant is
 * a separate, governed act, not a default. This is the substrate the two-owner
 * (User 1 + User 2) model stands on: each owner works inside their own
 * namespace, and a crossing is deliberate. Rebuilt SelfImpulse-owned —
 * attribution in docs/legal/THIRD-PARTY-NOTICES.md.
 */
export interface Namespace { id: string; owner: string; createdAt: number }

/** The bootstrap namespace every install works inside before any other is created. */
export const ROOT_NAMESPACE = "ns.default";

/** A stable, namespaced key for a named resource of a kind inside a namespace. */
export function nsKey(namespace: string, kind: string, name: string): string {
  return `si:${namespace}:${kind}:${name}`;
}

/** Fail-closed isolation: same namespace passes; anything else is refused. */
export function canAccess(resourceNamespace: string, actorNamespace: string): boolean {
  return resourceNamespace === actorNamespace;
}

export class NamespaceRegistry {
  private readonly ns = new Map<string, Namespace>();

  /** Idempotent: an existing namespace is returned untouched, never re-created. */
  ensure(id: string, owner: string, at: number): Namespace {
    const found = this.ns.get(id);
    if (found) return found;
    const created: Namespace = { id, owner, createdAt: at };
    this.ns.set(id, created);
    return created;
  }

  get(id: string): Namespace | null {
    return this.ns.get(id) ?? null;
  }

  list(): Namespace[] {
    return [...this.ns.values()];
  }
}
