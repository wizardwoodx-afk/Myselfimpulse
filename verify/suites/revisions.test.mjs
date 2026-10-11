import { createRequire as __mjCreateRequire } from "node:module"; const require = __mjCreateRequire(import.meta.url);

// probe/revisions.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/engine/revisions.ts
var RevisionLog = class {
  revs = [];
  active = 0;
  /** Append an immutable snapshot and activate it. Returns its id. */
  commit(snapshot, at, note) {
    const rev = this.revs.length + 1;
    this.revs.push({ rev, at, snapshot, note });
    this.active = rev;
    return rev;
  }
  /** The immutable snapshot that is live right now. */
  current() {
    return this.revs.find((r) => r.rev === this.active) ?? null;
  }
  activeRev() {
    return this.active;
  }
  list() {
    return [...this.revs];
  }
  get(rev) {
    return this.revs.find((r) => r.rev === rev) ?? null;
  }
  /** Point the running pointer at an existing snapshot. False for an unknown id (never faked). */
  setActive(rev) {
    if (!this.revs.some((r) => r.rev === rev)) return false;
    this.active = rev;
    return true;
  }
};

// probe/revisions.test.ts
test("commit appends immutable, auto-numbered snapshots and activates the newest", () => {
  const log = new RevisionLog();
  assert.equal(log.commit({ n: 1 }, 1), 1);
  assert.equal(log.commit({ n: 2 }, 2), 2);
  assert.equal(log.current()?.snapshot.n, 2);
  assert.equal(log.list().length, 2);
});
test("rollback/promote move the pointer only; a snapshot never changes", () => {
  const log = new RevisionLog();
  const r1 = log.commit({ n: 1 }, 1);
  log.commit({ n: 2 }, 2);
  assert.equal(log.setActive(r1), true);
  assert.equal(log.current()?.snapshot.n, 1);
  assert.deepEqual(log.get(r1)?.snapshot, { n: 1 });
  assert.equal(log.setActive(99), false);
  assert.equal(log.list().length, 2);
});
test("an unknown revision id is refused, never faked", () => {
  const log = new RevisionLog();
  log.commit("a", 1);
  assert.equal(log.get(7), null);
  assert.equal(log.current()?.rev, 1);
});
