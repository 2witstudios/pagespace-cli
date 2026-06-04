import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCompactionSummary, SESSIONS_PAGE } from "../../src/compaction.ts";

test("formatCompactionSummary renders a dated, token-tagged section", () => {
  const out = formatCompactionSummary("2026-06-04 21:50", 128000, "  did a bunch of things  ");
  assert.equal(
    out,
    "\n## 2026-06-04 21:50 — context compaction (128000 tokens before)\n\ndid a bunch of things",
  );
});

test("formatCompactionSummary starts with a blank line so it appends cleanly", () => {
  assert.match(formatCompactionSummary("t", 0, "x"), /^\n## /);
});

test("default Sessions page name is stable", () => {
  assert.equal(SESSIONS_PAGE, "Sessions");
});
