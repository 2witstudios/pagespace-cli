import { test } from "node:test";
import assert from "node:assert/strict";
import { isReadOnly } from "../../src/ops.ts";

test("isReadOnly is off when no prefixes are configured", () => {
  assert.equal(isReadOnly("drive/Specs/x", []), false);
});

test("isReadOnly protects a prefix dir and the prefix page itself (matched within the drive)", () => {
  assert.equal(isReadOnly("drive/Specs/auth", ["Specs"]), true);
  assert.equal(isReadOnly("drive/Specs", ["Specs"]), true);
  assert.equal(isReadOnly("drive/Epics/Epic 1/leaf", ["Specs", "Epics"]), true);
});

test("isReadOnly does not over-match siblings or substrings", () => {
  assert.equal(isReadOnly("drive/Specifications/x", ["Specs"]), false);
  assert.equal(isReadOnly("drive/Brain/note", ["Specs"]), false);
});

test("isReadOnly tolerates slashes around the configured prefix", () => {
  assert.equal(isReadOnly("drive/Specs/x", ["/Specs/"]), true);
});

test("isReadOnly returns false for the bare drive root", () => {
  assert.equal(isReadOnly("drive", ["Specs"]), false);
  assert.equal(isReadOnly("", ["Specs"]), false);
});
