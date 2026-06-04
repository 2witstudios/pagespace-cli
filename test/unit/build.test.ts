import { test } from "node:test";
import assert from "node:assert/strict";
import { isLeafDone, pickNextLeaf, formatBuildResult, buildNext } from "../../src/build.ts";
import type { PageSpaceApi, TaskRecord } from "../../src/api.ts";
import type { PageSpaceConfig } from "../../src/config.ts";

const task = (id: string, status: string, statusGroup?: string, pageId?: string): TaskRecord => ({
  id,
  title: id,
  status,
  statusGroup,
  pageId,
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
      spec: { criteria: [], gates: ["exit 0"], dependsOn: [] },
    }),
    /Next leaf: x[\s\S]*gates: \["exit 0"\][\s\S]*no work supplied/,
  );
  assert.match(
    formatBuildResult({
      done: false,
      leaf: task("y", "todo", "todo"),
      spec: { criteria: [{ given: "a", should: "b" }], gates: [], dependsOn: [] },
      result: {
        completed: true,
        gate: { pass: true, results: [] },
        review: { pass: true, issues: [], summary: "ok" },
      },
    }),
    /Next leaf: y[\s\S]*COMPLETED \(gate \+ review passed\)/,
  );
});

test("formatBuildResult reports all-dep-blocked", () => {
  assert.match(
    formatBuildResult({ done: false, blocked: [{ leaf: task("b", "todo", "todo"), unmet: ["a"] }] }),
    /All remaining leaves are blocked[\s\S]*b ⟂ needs: a/,
  );
});

test("buildNext skips a dep-blocked leaf and picks the next workable one (no network)", async () => {
  // Leaf A: done. Leaf B: active, depends-on A (met) → workable. Leaf C: active, depends-on Z (unmet).
  const tasks = [
    task("A", "completed", "done", "pA"),
    task("B", "pending", "todo", "pB"),
    task("C", "pending", "todo", "pC"),
  ];
  const specs: Record<string, string> = {
    pB: "- Given x, should y\ndepends-on: A",
    pC: "- Given x, should y\ndepends-on: Z",
  };
  const fakeApi = {
    async listTasks() {
      return tasks;
    },
    async readContent(pageId: string) {
      return specs[pageId] ?? "";
    },
  } as unknown as PageSpaceApi;
  const config = {} as PageSpaceConfig;

  // No work → surfaces the workable leaf (B), not the dep-blocked C.
  const r = await buildNext(fakeApi, config, { listPageId: "L", cwd: "/" });
  assert.equal(r.leaf?.id, "B");
  assert.equal(r.result, undefined);
});

test("buildNext returns blocked list when every active leaf is dep-blocked", async () => {
  const tasks = [task("B", "pending", "todo", "pB")];
  const fakeApi = {
    async listTasks() {
      return tasks;
    },
    async readContent() {
      return "depends-on: NotDone";
    },
  } as unknown as PageSpaceApi;
  const r = await buildNext(fakeApi, {} as PageSpaceConfig, { listPageId: "L", cwd: "/" });
  assert.equal(r.done, false);
  assert.equal(r.leaf, undefined);
  assert.deepEqual(r.blocked, [{ leaf: tasks[0], unmet: ["NotDone"] }]);
});
