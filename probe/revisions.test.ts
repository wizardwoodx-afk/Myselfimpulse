import test from "node:test";
import assert from "node:assert/strict";
import { RevisionLog } from "../src/engine/revisions";

test("commit appends immutable, auto-numbered snapshots and activates the newest", () => {
  const log = new RevisionLog<{ n: number }>();
  assert.equal(log.commit({ n: 1 }, 1), 1);
  assert.equal(log.commit({ n: 2 }, 2), 2);
  assert.equal(log.current()?.snapshot.n, 2);
  assert.equal(log.list().length, 2);
});

test("rollback/promote move the pointer only; a snapshot never changes", () => {
  const log = new RevisionLog<{ n: number }>();
  const r1 = log.commit({ n: 1 }, 1);
  log.commit({ n: 2 }, 2);
  assert.equal(log.setActive(r1), true);
  assert.equal(log.current()?.snapshot.n, 1);
  assert.deepEqual(log.get(r1)?.snapshot, { n: 1 }); // r1 unchanged by r2
  assert.equal(log.setActive(99), false);            // unknown id refused
  assert.equal(log.list().length, 2);                // nothing removed
});

test("an unknown revision id is refused, never faked", () => {
  const log = new RevisionLog<string>();
  log.commit("a", 1);
  assert.equal(log.get(7), null);
  assert.equal(log.current()?.rev, 1);
});
