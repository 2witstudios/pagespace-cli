import { test } from "node:test";
import assert from "node:assert/strict";
import { recordAttempt, attemptCount, attemptsExceeded, withinBudget } from "../../src/rails.ts";

test("recordAttempt increments and returns the per-leaf count", () => {
  const log = new Map<string, number>();
  assert.equal(recordAttempt(log, "a"), 1);
  assert.equal(recordAttempt(log, "a"), 2);
  assert.equal(recordAttempt(log, "b"), 1);
  assert.equal(attemptCount(log, "a"), 2);
  assert.equal(attemptCount(log, "z"), 0);
});

test("attemptsExceeded fires at the cap (default 3)", () => {
  const log = new Map<string, number>([["a", 2]]);
  assert.equal(attemptsExceeded(log, "a"), false);
  log.set("a", 3);
  assert.equal(attemptsExceeded(log, "a"), true);
  assert.equal(attemptsExceeded(log, "a", 5), false);
});

test("withinBudget: undefined budget is unlimited; otherwise strict less-than", () => {
  assert.equal(withinBudget(1000, undefined), true);
  assert.equal(withinBudget(99, 100), true);
  assert.equal(withinBudget(100, 100), false);
  assert.equal(withinBudget(101, 100), false);
});
