import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSpaceResolver } from "../../src/resolve.ts";

test("split separates drive slug from segments", () => {
  assert.deepEqual(PageSpaceResolver.split("mydrive/Brain/overview"), {
    driveSlug: "mydrive",
    segments: ["Brain", "overview"],
  });
});

test("split with only a drive slug yields empty segments", () => {
  assert.deepEqual(PageSpaceResolver.split("mydrive"), { driveSlug: "mydrive", segments: [] });
});

test("split ignores empty path parts (leading/duplicate slashes)", () => {
  assert.deepEqual(PageSpaceResolver.split("/mydrive//a/b/"), {
    driveSlug: "mydrive",
    segments: ["a", "b"],
  });
});

test("split throws on an empty path", () => {
  assert.throws(() => PageSpaceResolver.split(""), /Empty PageSpace path/);
});
