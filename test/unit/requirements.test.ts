import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonArray,
  parseRequirements,
  formatRequirements,
  buildRequirementsMessages,
} from "../../src/requirements.ts";
import { collectSseText } from "../../src/brain.ts";

test("extractJsonArray pulls the first balanced array, ignoring surrounding prose/fences", () => {
  assert.deepEqual(extractJsonArray('here you go:\n```json\n[{"a":1},{"b":[2,3]}]\n```'), [
    { a: 1 },
    { b: [2, 3] },
  ]);
  assert.equal(extractJsonArray("no array here"), null);
  assert.equal(extractJsonArray('[ {"a": 1} '), null); // unbalanced
});

test("extractJsonArray is string-aware (brackets inside strings don't break balance)", () => {
  assert.deepEqual(extractJsonArray('[{"s": "has ] bracket"}]'), [{ s: "has ] bracket" }]);
});

test("parseRequirements keeps only items with non-empty given+should", () => {
  const text = `[
    {"given": "a request", "should": "produce criteria"},
    {"given": "", "should": "dropped"},
    {"given": "no should"},
    {"given": "  trimmed  ", "should": "  ok  "}
  ]`;
  assert.deepEqual(parseRequirements(text), [
    { given: "a request", should: "produce criteria" },
    { given: "trimmed", should: "ok" },
  ]);
});

test("parseRequirements returns [] for non-JSON model output", () => {
  assert.deepEqual(parseRequirements("I cannot do that."), []);
});

test("formatRequirements renders AIDD Given/should bullets, empty when none", () => {
  assert.equal(formatRequirements([]), "");
  assert.equal(
    formatRequirements([
      { given: "X", should: "Y" },
      { given: "A", should: "B" },
    ]),
    "- Given X, should Y\n- Given A, should B",
  );
});

test("buildRequirementsMessages produces a system+user pair carrying the request", () => {
  const msgs = buildRequirementsMessages("build a thing");
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /Given X, should Y/);
  assert.equal(msgs[1].role, "user");
  assert.match(msgs[1].content, /build a thing/);
});

test("collectSseText concatenates OpenAI-style streamed deltas", () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    'data: {"choices":[{"delta":{"content":", world"}}]}',
    ": keepalive",
    "data: [DONE]",
  ].join("\n");
  assert.equal(collectSseText(sse), "Hello, world");
});
