import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChurn, formatChurn } from "../../src/churn.ts";

const SAMPLE = [
  "0123456789abcdef0123456789abcdef01234567",
  "src/a.ts",
  "src/b.ts",
  "",
  "fedcba9876543210fedcba9876543210fedcba98",
  "src/a.ts",
  "",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "src/a.ts",
  "src/c.ts",
].join("\n");

test("parseChurn counts file occurrences across commits, sorted by frequency then path", () => {
  assert.deepEqual(parseChurn(SAMPLE), [
    { file: "src/a.ts", commits: 3 },
    { file: "src/b.ts", commits: 1 },
    { file: "src/c.ts", commits: 1 },
  ]);
});

test("parseChurn ignores 40-char hash lines and blanks; empty input => []", () => {
  assert.deepEqual(parseChurn(""), []);
  assert.deepEqual(parseChurn("0123456789abcdef0123456789abcdef01234567\n\n"), []);
});

test("formatChurn renders a count/file table and respects the limit", () => {
  const out = formatChurn(
    [
      { file: "x.ts", commits: 12 },
      { file: "y.ts", commits: 3 },
    ],
    1,
  );
  assert.equal(out, "  12  x.ts");
  assert.equal(formatChurn([]), "(no churn data)");
});
