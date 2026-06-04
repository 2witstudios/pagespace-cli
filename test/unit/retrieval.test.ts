import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrainQuery, scoreContent, rankAndTrim, formatRetrievedNotes } from "../../src/retrieval.ts";

test("buildBrainQuery extracts significant, deduped keywords and drops stopwords/short words", () => {
  const kw = buildBrainQuery("How does the model brain handle the prompted tool protocol?");
  assert.ok(kw.includes("model"));
  assert.ok(kw.includes("brain"));
  assert.ok(kw.includes("prompted"));
  assert.ok(kw.includes("protocol"));
  assert.ok(!kw.includes("the")); // stopword
  assert.ok(!kw.includes("how")); // stopword
  assert.deepEqual(kw, [...new Set(kw)]); // deduped
});

test("buildBrainQuery returns nothing useful for a contentless prompt", () => {
  assert.deepEqual(buildBrainQuery("ok do it now"), []); // all short/stopwords
});

test("buildBrainQuery caps the number of keywords", () => {
  const kw = buildBrainQuery("alpha bravo charlie delta echo foxtrot golf hotel india juliet", 3);
  assert.equal(kw.length, 3);
});

test("scoreContent counts case-insensitive keyword occurrences", () => {
  assert.equal(scoreContent("Brain brain BRAIN of the brainy", ["brain"]), 4); // incl. 'brainy'
  assert.equal(scoreContent("nothing here", ["brain"]), 0);
});

test("rankAndTrim orders by score, drops zero-score, and respects topK", () => {
  const notes = [
    { source: "a", content: "brain brain brain" },
    { source: "b", content: "brain" },
    { source: "c", content: "unrelated text" },
    { source: "d", content: "brain brain" },
  ];
  const out = rankAndTrim(notes, ["brain"], { topK: 2, maxChars: 10_000 });
  assert.deepEqual(
    out.map((n) => n.source),
    ["a", "d"],
  );
  assert.ok(out.every((n) => n.score > 0));
});

test("rankAndTrim enforces the total character budget", () => {
  const big = "brain ".repeat(500); // 3000 chars
  const out = rankAndTrim([{ source: "x", content: big }], ["brain"], { topK: 3, maxChars: 100 });
  assert.equal(out.length, 1);
  assert.ok(out[0].content.length <= 100 + "\n…[trimmed]".length);
  assert.match(out[0].content, /\[trimmed\]$/);
});

test("formatRetrievedNotes wraps notes and is empty when there are none", () => {
  assert.equal(formatRetrievedNotes([]), "");
  const out = formatRetrievedNotes([{ source: "Brain/x", content: "hello", score: 2 }]);
  assert.match(out, /# Relevant Brain notes for this turn/);
  assert.match(out, /<brain_note source="Brain\/x" relevance="2">\nhello\n<\/brain_note>/);
});
