import { test } from "node:test";
import assert from "node:assert/strict";
import { tryExtractFirstJsonObject } from "../../src/json-extract.ts";

test("extracts a plain object", () => {
  const r = tryExtractFirstJsonObject('{"a":1,"b":"x"}');
  assert.deepEqual(r?.value, { a: 1, b: "x" });
  assert.equal(r?.end, 15);
});

test("extracts the FIRST object out of surrounding prose", () => {
  const r = tryExtractFirstJsonObject('Sure! Here it is: {"ok":true} — done.');
  assert.deepEqual(r?.value, { ok: true });
});

test("handles nested objects (brace-balanced)", () => {
  const r = tryExtractFirstJsonObject('{"a":{"b":{"c":2}},"d":3}trailing');
  assert.deepEqual(r?.value, { a: { b: { c: 2 } }, d: 3 });
});

test("braces inside strings don't break balancing", () => {
  const r = tryExtractFirstJsonObject('{"s":"a { b } c","n":1}');
  assert.deepEqual(r?.value, { s: "a { b } c", n: 1 });
});

test("escaped quotes inside strings are respected", () => {
  const r = tryExtractFirstJsonObject('{"s":"he said \\"hi\\" } "}');
  assert.deepEqual(r?.value, { s: 'he said "hi" } ' });
});

test("no object → null", () => {
  assert.equal(tryExtractFirstJsonObject("no json here"), null);
});

test("incomplete object → null", () => {
  assert.equal(tryExtractFirstJsonObject('{"a":1'), null);
});

test("unparseable braces → null", () => {
  assert.equal(tryExtractFirstJsonObject("{not valid json}"), null);
});
