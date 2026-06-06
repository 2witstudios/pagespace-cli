import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCwdDir,
  extractJsonl,
  parseHeader,
  resolveSessionRef,
  sessionIdFromTitle,
} from "../../bin/session-read.mjs";
import { renderSessionPage } from "../../src/session-sync.ts";

// Drift guard: the bin's read-side (plain JS) must stay compatible with the TS writer in session-sync.
test("bin extractJsonl round-trips src renderSessionPage byte-for-byte (incl. backticks)", () => {
  const jsonl = [
    '{"type":"session","version":3,"id":"019e8fe8-126c-70bc-9870-3f8eef61d9de","timestamp":"2026-06-03T23:53:31.501Z","cwd":"/x"}',
    '{"type":"message","id":"u","message":{"role":"user","content":[{"type":"text","text":"```js\\nx=1\\n```"}]}}',
  ].join("\n");
  const page = renderSessionPage(jsonl, { updatedAt: "t", machine: "m" });
  assert.equal(extractJsonl(page), jsonl.trimEnd());
});

test("bin encodeCwdDir matches pi's --<cwd>-- scheme", () => {
  assert.equal(
    encodeCwdDir("/Users/jono/production/pagespace-cli"),
    "--Users-jono-production-pagespace-cli--",
  );
});

test("bin parseHeader extracts the session header; null on non-header", () => {
  const h = parseHeader('{"type":"session","id":"abc","timestamp":"T","cwd":"/c"}\n{"type":"message"}');
  assert.equal(h.id, "abc");
  assert.equal(h.cwd, "/c");
  assert.equal(parseHeader('{"type":"message"}'), null);
});

test("bin sessionIdFromTitle extracts the full id (preview may contain ' · ')", () => {
  assert.equal(
    sessionIdFromTitle("019e8fe8-126c-70bc-9870-3f8eef61d9de · a · b"),
    "019e8fe8-126c-70bc-9870-3f8eef61d9de",
  );
});

test("bin resolveSessionRef: exact / unique-prefix / ambiguous-shortId", () => {
  const all = [{ id: "019e8fe8-126c-aa" }, { id: "019e8fe8-7e40-bb" }];
  assert.equal(resolveSessionRef(all, "019e8fe8-126c-aa").match.id, "019e8fe8-126c-aa");
  assert.equal(resolveSessionRef(all, "019e8fe8-126c").match.id, "019e8fe8-126c-aa");
  const amb = resolveSessionRef(all, "019e8fe8");
  assert.equal(amb.match, undefined);
  assert.equal(amb.candidates.length, 2);
});
