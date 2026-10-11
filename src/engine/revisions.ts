/**
 * SelfImpulse — Immutable revisions.
 *
 * ADAPTED from a third-party MIT control-plane's "AgentRevision" idea: a change
 * becomes an immutable, numbered snapshot; editing never mutates what is live;
 * the running pointer can be moved back (rollback) or forward (promote) to any
 * snapshot by id. The snapshot is the unit of truth; the pointer is the only
 * thing that moves. Rebuilt SelfImpulse-owned — attribution in
 * docs/legal/THIRD-PARTY-NOTICES.md.
 */
export interface Revision<T> {
  rev: number;
  at: number;
  snapshot: T;
  note?: string;
}

export class RevisionLog<T> {
  private readonly revs: Array<Revision<T>> = [];
  private active = 0;

  /** Append an immutable snapshot and activate it. Returns its id. */
  commit(snapshot: T, at: number, note?: string): number {
    const rev = this.revs.length + 1;
    this.revs.push({ rev, at, snapshot, note });
    this.active = rev;
    return rev;
  }

  /** The immutable snapshot that is live right now. */
  current(): Revision<T> | null {
    return this.revs.find((r) => r.rev === this.active) ?? null;
  }

  activeRev(): number {
    return this.active;
  }

  list(): readonly Revision<T>[] {
    return [...this.revs];
  }

  get(rev: number): Revision<T> | null {
    return this.revs.find((r) => r.rev === rev) ?? null;
  }

  /** Point the running pointer at an existing snapshot. False for an unknown id (never faked). */
  setActive(rev: number): boolean {
    if (!this.revs.some((r) => r.rev === rev)) return false;
    this.active = rev;
    return true;
  }
}
