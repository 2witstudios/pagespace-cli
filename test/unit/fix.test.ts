import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFix, formatFix, buildFixMessages } from "../../src/fix.ts";

test("parseFix reads diagnosis + fix.change + optional file/newTests", () => {
  const text =
    'sure: {"diagnosis":"off-by-one in loop bound","fix":{"file":"sum.ts","change":"use i < arr.length"},"newTests":"sum([1,2,3]) === 6"}';
  assert.deepEqual(parseFix(text), {
    diagnosis: "off-by-one in loop bound",
    fix: { file: "sum.ts", change: "use i < arr.length" },
    newTests: "sum([1,2,3]) === 6",
  });
});

test("parseFix accepts a top-level change and omits absent optional fields", () => {
  assert.deepEqual(parseFix('{"diagnosis":"d","change":"do x"}'), {
    diagnosis: "d",
    fix: { file: undefined, change: "do x" },
    newTests: undefined,
  });
});

test("parseFix returns null with no diagnosis and no change", () => {
  assert.equal(parseFix('{"unrelated":"x"}'), null);
  assert.equal(parseFix("no json at all"), null);
});

test("formatFix renders the proposal, including optional lines only when present", () => {
  assert.equal(formatFix({ diagnosis: "d", fix: { change: "c" } }), "Diagnosis: d\nFix: c");
  assert.equal(
    formatFix({ diagnosis: "d", fix: { file: "f.ts", change: "c" }, newTests: "t" }),
    "Diagnosis: d\nFile: f.ts\nFix: c\nTest to add: t",
  );
});

test("buildFixMessages carries the failure and context", () => {
  const msgs = buildFixMessages("AssertionError: 3 !== 6", "function sum(){...}");
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[1].content, /AssertionError: 3 !== 6/);
  assert.match(msgs[1].content, /function sum/);
});
