import { test } from "node:test";
import assert from "node:assert/strict";
import { literalToPgRegex, regexToCaseInsensitive, matchLinesIn, globToRegExp } from "../../src/ops.ts";

test("literalToPgRegex is backslash-free and bracket-escapes metachars", () => {
  const out = literalToPgRegex("(dual-mount).*", false);
  assert.ok(!out.includes("\\("), "must not backslash-escape (the server doubles lone backslashes)");
  assert.equal(out, "[(]dual[-]mount[)][.][*]");
});

test("literalToPgRegex applies case-insensitivity via char classes", () => {
  assert.equal(literalToPgRegex("Ab", true), "[aA][bB]");
});

test("literalToPgRegex handles the awkward ] char", () => {
  assert.equal(literalToPgRegex("a]b", false), "a[]]b");
});

test("regexToCaseInsensitive rewrites letters as [aA] outside classes", () => {
  assert.equal(regexToCaseInsensitive("Go"), "[gG][oO]");
});

test("regexToCaseInsensitive preserves escapes like \\d and \\w", () => {
  // The 'd' in \d must NOT be turned into [dD].
  assert.equal(regexToCaseInsensitive("\\dfoo"), "\\d[fF][oO][oO]");
});

test("regexToCaseInsensitive doubles letters inside a char class without nesting", () => {
  assert.equal(regexToCaseInsensitive("[ab]"), "[aAbB]");
});

test("regexToCaseInsensitive output is a valid, case-insensitive regex", () => {
  const re = new RegExp(regexToCaseInsensitive("overview"));
  assert.ok(re.test("# Overview"));
  assert.ok(re.test("OVERVIEW"));
  assert.ok(!re.test("over view"));
});

test("matchLinesIn returns 1-based line numbers for matches only", () => {
  const content = "alpha\nbeta\ngamma beta\ndelta";
  const got = matchLinesIn(content, /beta/);
  assert.deepEqual(got, [
    { lineNumber: 2, content: "beta" },
    { lineNumber: 3, content: "gamma beta" },
  ]);
});

test("matchLinesIn normalizes CRLF", () => {
  assert.deepEqual(matchLinesIn("a\r\nbXb\r\nc", /X/), [{ lineNumber: 2, content: "bXb" }]);
});

test("globToRegExp: *.ts matches a single segment only", () => {
  const re = globToRegExp("*.ts");
  assert.ok(re.test("a.ts"));
  assert.ok(!re.test("dir/a.ts"));
});

test("globToRegExp: **/*.ts crosses directories", () => {
  const re = globToRegExp("**/*.ts");
  assert.ok(re.test("a/b/c.ts"));
});

test("globToRegExp escapes regex metacharacters in literals", () => {
  const re = globToRegExp("a.b");
  assert.ok(re.test("a.b"));
  assert.ok(!re.test("axb"));
});
