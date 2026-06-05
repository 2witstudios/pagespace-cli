import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCwdDir,
  extractJsonl,
  parseSessionHeader,
  parseSessionMeta,
  renderSessionPage,
  renderTranscript,
  sessionFileName,
} from "../../src/session-sync.ts";

const HEADER =
  '{"type":"session","version":3,"id":"019e8fe8-126c-70bc-9870-3f8eef61d9de","timestamp":"2026-06-03T23:53:31.501Z","cwd":"/Users/jono/production/pagespace-cli"}';
const USER =
  '{"type":"message","id":"a1","message":{"role":"user","content":[{"type":"text","text":"read package.json and tell me the name"}]}}';
const ASSISTANT =
  '{"type":"message","id":"a2","message":{"role":"assistant","content":[{"type":"toolCall","name":"read","arguments":{"path":"package.json"}}]}}';
const SAMPLE = [HEADER, USER, ASSISTANT].join("\n");

test("encodeCwdDir reproduces pi's --<cwd>-- scheme", () => {
  assert.equal(
    encodeCwdDir("/Users/jono/production/pagespace-cli"),
    "--Users-jono-production-pagespace-cli--",
  );
  assert.equal(encodeCwdDir("/Users/jono"), "--Users-jono--");
  // drive-letter colon AND backslash each collapse to a dash (matches pi's regex)
  assert.equal(encodeCwdDir("C:\\work\\proj"), "--C--work-proj--");
});

test("parseSessionHeader extracts id/timestamp/cwd; null on non-header", () => {
  const h = parseSessionHeader(SAMPLE);
  assert.equal(h?.id, "019e8fe8-126c-70bc-9870-3f8eef61d9de");
  assert.equal(h?.timestamp, "2026-06-03T23:53:31.501Z");
  assert.equal(h?.cwd, "/Users/jono/production/pagespace-cli");
  assert.equal(parseSessionHeader('{"type":"message"}'), null);
  assert.equal(parseSessionHeader("not json"), null);
});

test("sessionFileName matches pi's <ts with :.->_<id>.jsonl", () => {
  const h = parseSessionHeader(SAMPLE);
  assert.ok(h);
  assert.equal(sessionFileName(h), "2026-06-03T23-53-31-501Z_019e8fe8-126c-70bc-9870-3f8eef61d9de.jsonl");
});

test("parseSessionMeta derives id, short id, preview, turn count", () => {
  const m = parseSessionMeta(SAMPLE);
  assert.equal(m.id, "019e8fe8-126c-70bc-9870-3f8eef61d9de");
  assert.equal(m.shortId, "019e8fe8");
  assert.equal(m.turns, 1);
  assert.match(m.preview, /read package\.json/);
  assert.ok(m.title.startsWith("019e8fe8 · "));
});

test("renderTranscript shows user/assistant text and tool-call names, never throws", () => {
  const t = renderTranscript(SAMPLE);
  assert.match(t, /\*\*User:\*\* read package\.json/);
  assert.match(t, /↳ `read`/);
  assert.equal(renderTranscript("garbage\n{bad json}"), "_(no turns yet)_");
});

test("renderSessionPage → extractJsonl round-trips the JSONL byte-for-byte", () => {
  const page = renderSessionPage(SAMPLE, { updatedAt: "2026-06-05 10:00", machine: "macbook" });
  assert.match(page, /# Session 019e8fe8/);
  assert.match(page, /\*\*machine:\*\* macbook/);
  const out = extractJsonl(page);
  assert.equal(out, SAMPLE.trimEnd());
});

test("extractJsonl survives a backtick fence appearing inside a JSON string", () => {
  const tricky = [
    HEADER,
    '{"type":"message","id":"x","message":{"role":"user","content":[{"type":"text","text":"```js\\nconst x=1\\n```"}]}}',
  ].join("\n");
  const page = renderSessionPage(tricky, { updatedAt: "t" });
  assert.equal(extractJsonl(page), tricky.trimEnd());
});

test("extractJsonl returns null when no embedded session is present", () => {
  assert.equal(extractJsonl("# just a normal page\n\nno session here"), null);
});
