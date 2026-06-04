import { test } from "node:test";
import assert from "node:assert/strict";
import { isLeafDone, pickNextLeaf, formatBuildResult } from "../../src/build.ts";
import type { TaskRecord } from "../../src/api.ts";

const task = (id: string, status: string, statusGroup?: string): TaskRecord => ({
  id,
  title: id,
  status,
  statusGroup,
});

test("isLeafDone recognizes done by group or status", () => {
  assert.equal(isLeafDone(task("a", "completed")), true);
  assert.equal(isLeafDone(task("b", "anything", "done")), true);
  assert.equal(isLeafDone(task("c", "in_progress", "active")), false);
  assert.equal(isLeafDone(task("d", "pending", "todo")), false);
});

test("pickNextLeaf returns the first non-done task in order", () => {
  const tasks = [task("1", "completed", "done"), task("2", "pending", "todo"), task("3", "pending", "todo")];
  assert.equal(pickNextLeaf(tasks)?.id, "2");
});

test("pickNextLeaf returns null when every task is done", () => {
  assert.equal(pickNextLeaf([task("1", "completed", "done"), task("2", "done", "done")]), null);
  assert.equal(pickNextLeaf([]), null);
});

test("formatBuildResult: done, surfaced-only, and gated results", () => {
  assert.match(formatBuildResult({ done: true }), /No active leaf remaining/);
  assert.match(
    formatBuildResult({
      done: false,
      leaf: task("x", "todo", "todo"),
      spec: { criteria: [], gates: ["exit 0"] },
    }),
    /Next leaf: x[\s\S]*gates: \["exit 0"\][\s\S]*no work supplied/,
  );
  assert.match(
    formatBuildResult({
      done: false,
      leaf: task("y", "todo", "todo"),
      spec: { criteria: [{ given: "a", should: "b" }], gates: [] },
      result: {
        completed: true,
        gate: { pass: true, results: [] },
        review: { pass: true, issues: [], summary: "ok" },
      },
    }),
    /Next leaf: y[\s\S]*COMPLETED \(gate \+ review passed\)/,
  );
});
