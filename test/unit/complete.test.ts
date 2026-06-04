import { test } from "node:test";
import assert from "node:assert/strict";
import { decideComplete, formatCompleteResult } from "../../src/complete.ts";
import type { ReviewVerdict } from "../../src/review.ts";

const PASS_REVIEW: ReviewVerdict = { pass: true, issues: [], summary: "ok" };
const FAIL_REVIEW: ReviewVerdict = {
  pass: false,
  issues: [{ severity: "blocker", note: "broken" }],
  summary: "no",
};

test("decideComplete: gate must pass; review (when present) must also pass", () => {
  assert.equal(decideComplete(false, undefined), false); // gate failed
  assert.equal(decideComplete(false, PASS_REVIEW), false); // gate failed even if review ok
  assert.equal(decideComplete(true, undefined), true); // gate ok, no review
  assert.equal(decideComplete(true, PASS_REVIEW), true); // both ok
  assert.equal(decideComplete(true, FAIL_REVIEW), false); // review blocks despite gate
});

test("formatCompleteResult shows the gate and review lines", () => {
  const out = formatCompleteResult({
    completed: false,
    gate: { pass: true, results: [{ command: "npm test", pass: true, code: 0, stdout: "", stderr: "" }] },
    review: FAIL_REVIEW,
  });
  assert.match(out, /^BLOCKED/);
  assert.match(out, /✓ gate: npm test/);
  assert.match(out, /✗ review: no/);
  assert.match(out, /\[blocker\] broken/);
});

test("formatCompleteResult: completed header + reason passthrough", () => {
  assert.match(
    formatCompleteResult({ completed: true, gate: { pass: true, results: [] }, review: PASS_REVIEW }),
    /COMPLETED \(gate \+ review passed\)/,
  );
  assert.equal(
    formatCompleteResult({
      completed: false,
      gate: { pass: false, results: [] },
      reason: "No gate or review",
    }),
    "No gate or review",
  );
});
