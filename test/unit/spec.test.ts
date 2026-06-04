import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec, formatSpec, hasGate, unmetDeps } from "../../src/spec.ts";

const SAMPLE = `# Some leaf

Background prose that should be ignored.

- Given a markdown note is created, should set contentMode to markdown
- Given an append-only log, should insert at the end

gate: npm run check
gate: tsx test/run-x.ts

More prose.`;

test("parseSpec extracts Given/should criteria and gate commands", () => {
  const spec = parseSpec(SAMPLE);
  assert.deepEqual(spec.criteria, [
    { given: "a markdown note is created", should: "set contentMode to markdown" },
    { given: "an append-only log", should: "insert at the end" },
  ]);
  assert.deepEqual(spec.gates, ["npm run check", "tsx test/run-x.ts"]);
  assert.deepEqual(spec.dependsOn, []);
});

test("parseSpec extracts depends-on (comma + multiple lines, depends/depends-on/depends_on)", () => {
  const spec = parseSpec("depends-on: Spec format, Gated complete\ndepends: build loop\n- Given x, should y");
  assert.deepEqual(spec.dependsOn, ["Spec format", "Gated complete", "build loop"]);
});

test("unmetDeps returns the deps not yet done", () => {
  assert.deepEqual(unmetDeps(["a", "b", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(unmetDeps([], ["b"]), []);
  assert.deepEqual(unmetDeps(["a"], ["a"]), []);
});

test("parseSpec keeps commas inside the situation (greedy given)", () => {
  const spec = parseSpec("- Given a, b, and c, should work");
  assert.deepEqual(spec.criteria, [{ given: "a, b, and c", should: "work" }]);
});

test("parseSpec on text without criteria/gates yields empty arrays", () => {
  const spec = parseSpec("just a description, nothing structured");
  assert.deepEqual(spec, { criteria: [], gates: [], dependsOn: [] });
  assert.equal(hasGate(spec), false);
});

test("hasGate reflects gate presence", () => {
  assert.equal(hasGate({ criteria: [], gates: ["x"], dependsOn: [] }), true);
  assert.equal(hasGate({ criteria: [{ given: "a", should: "b" }], gates: [], dependsOn: [] }), false);
});

test("formatSpec round-trips through parseSpec (incl. depends-on)", () => {
  const spec = { criteria: [{ given: "X", should: "Y" }], gates: ["npm test"], dependsOn: ["other leaf"] };
  assert.deepEqual(parseSpec(formatSpec(spec)), spec);
});
