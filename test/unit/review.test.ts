import { test } from "node:test";
import assert from "node:assert/strict";
import { computePass, parseVerdict, formatVerdict, buildReviewMessages } from "../../src/review.ts";

test("computePass: a blocker fails the gate; major/minor pass", () => {
  assert.equal(computePass([]), true);
  assert.equal(
    computePass([
      { severity: "minor", note: "x" },
      { severity: "major", note: "y" },
    ]),
    true,
  );
  assert.equal(computePass([{ severity: "blocker", note: "broken" }]), false);
});

test("parseVerdict reads issues and computes pass in code (not from the model)", () => {
  const text =
    'verdict: {"summary":"looks broken","issues":[{"severity":"blocker","note":"multiplies instead of divides"}]}';
  const v = parseVerdict(text);
  assert.equal(v.pass, false);
  assert.equal(v.summary, "looks broken");
  assert.deepEqual(v.issues, [{ severity: "blocker", note: "multiplies instead of divides" }]);
});

test("parseVerdict passes when issues is empty", () => {
  const v = parseVerdict('{"summary":"meets all criteria","issues":[]}');
  assert.equal(v.pass, true);
  assert.equal(v.issues.length, 0);
});

test("parseVerdict normalizes severity synonyms and accepts note/issue keys", () => {
  const v = parseVerdict(
    '{"issues":[{"severity":"critical","issue":"a"},{"severity":"high","note":"b"},{"severity":"nit","note":"c"}]}',
  );
  assert.deepEqual(v.issues, [
    { severity: "blocker", note: "a" },
    { severity: "major", note: "b" },
    { severity: "minor", note: "c" },
  ]);
  assert.equal(v.pass, false); // has a blocker
});

test("parseVerdict is fail-safe: no parseable verdict => gate FAILS", () => {
  const v = parseVerdict("I think it's probably fine.");
  assert.equal(v.pass, false);
  assert.equal(v.issues[0].severity, "blocker");
});

test("formatVerdict renders pass/fail with issues", () => {
  assert.match(formatVerdict({ pass: true, issues: [], summary: "ok" }), /^PASS: ok$/);
  const out = formatVerdict({ pass: false, issues: [{ severity: "blocker", note: "bad" }], summary: "no" });
  assert.match(out, /^FAIL: no\n {2}\[blocker\] bad$/);
});

test("buildReviewMessages carries both rubric and work", () => {
  const msgs = buildReviewMessages("changed X", "Given A, should B");
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[1].content, /Given A, should B/);
  assert.match(msgs[1].content, /changed X/);
});
