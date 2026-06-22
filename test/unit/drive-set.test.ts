import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDriveSet, resolveDefaultDrive } from "../../src/config.ts";

test("parseDriveSet returns empty when neither PAGESPACE_DRIVE nor PAGESPACE_DRIVES is set", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVE: undefined, PAGESPACE_DRIVES: undefined });
  assert.deepEqual(r.drives, []);
  assert.equal(r.default, undefined);
});

test("parseDriveSet reads a single PAGESPACE_DRIVE", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVE: "pagespace-cli" });
  assert.deepEqual(r.drives, ["pagespace-cli"]);
  assert.equal(r.default, "pagespace-cli");
});

test("parseDriveSet reads a comma-separated PAGESPACE_DRIVES", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVES: "pagespace-cli,pure-point,pagespace" });
  assert.deepEqual(r.drives, ["pagespace-cli", "pure-point", "pagespace"]);
  assert.equal(r.default, "pagespace-cli", "first drive is the default");
});

test("parseDriveSet dedupes drives (case-preserving)", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVES: "a,b,a" });
  assert.deepEqual(r.drives, ["a", "b"]);
});

test("parseDriveSet trims whitespace and drops empties", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVES: " a , , b " });
  assert.deepEqual(r.drives, ["a", "b"]);
});

test("parseDriveSet merges PAGESPACE_DRIVE into PAGESPACE_DRIVES (drive first, deduped)", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVE: "pagespace-cli", PAGESPACE_DRIVES: "pure-point,pagespace-cli" });
  assert.deepEqual(r.drives, ["pagespace-cli", "pure-point"]);
  assert.equal(r.default, "pagespace-cli");
});

test("parseDriveSet: when only PAGESPACE_DRIVES is set, its first entry is the default", () => {
  const r = parseDriveSet({ PAGESPACE_DRIVES: "pure-point,pagespace-cli" });
  assert.equal(r.default, "pure-point");
});

test("resolveDefaultDrive prefers PAGESPACE_DRIVE, falls back to first of DRIVES, else undefined", () => {
  assert.equal(resolveDefaultDrive({ PAGESPACE_DRIVE: "a", PAGESPACE_DRIVES: "b,c" }), "a");
  assert.equal(resolveDefaultDrive({ PAGESPACE_DRIVE: undefined, PAGESPACE_DRIVES: "b,c" }), "b");
  assert.equal(resolveDefaultDrive({ PAGESPACE_DRIVE: undefined, PAGESPACE_DRIVES: undefined }), undefined);
});
