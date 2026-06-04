import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec, formatSpec, hasGate } from "../../src/spec.ts";

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
});

test("parseSpec keeps commas inside the situation (greedy given)", () => {
  const spec = parseSpec("- Given a, b, and c, should work");
  assert.deepEqual(spec.criteria, [{ given: "a, b, and c", should: "work" }]);
});

test("parseSpec on text without criteria/gates yields empty arrays", () => {
  const spec = parseSpec("just a description, nothing structured");
  assert.deepEqual(spec, { criteria: [], gates: [] });
  assert.equal(hasGate(spec), false);
});

test("hasGate reflects gate presence", () => {
  assert.equal(hasGate({ criteria: [], gates: ["x"] }), true);
  assert.equal(hasGate({ criteria: [{ given: "a", should: "b" }], gates: [] }), false);
});

test("formatSpec round-trips through parseSpec", () => {
  const spec = { criteria: [{ given: "X", should: "Y" }], gates: ["npm test"] };
  assert.deepEqual(parseSpec(formatSpec(spec)), spec);
});
