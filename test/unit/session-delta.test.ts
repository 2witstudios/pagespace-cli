import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSyncDelta, jsonlLines, planSync, reconcileSyncedLines } from "../../src/session-sync.ts";

const L = (...lines: string[]) => `${lines.join("\n")}\n`;
const A = '{"i":1}';
const B = '{"i":2}';
const C = '{"i":3}';

test("jsonlLines: non-empty lines only", () => {
  assert.deepEqual(jsonlLines(`${A}\n\n${B}\n  \n${C}\n`), [A, B, C]);
  assert.deepEqual(jsonlLines(""), []);
});

test("computeSyncDelta: appends only the tail past the synced offset", () => {
  const d = computeSyncDelta(L(A, B, C), 1);
  assert.equal(d.append, `${B}\n${C}`);
  assert.equal(d.total, 3);
  assert.equal(d.diverged, false);
});

test("computeSyncDelta: no-op when everything is already synced", () => {
  const d = computeSyncDelta(L(A, B), 2);
  assert.equal(d.append, "");
  assert.equal(d.total, 2);
  assert.equal(d.diverged, false);
});

test("computeSyncDelta: diverged when the synced offset exceeds the local length", () => {
  const d = computeSyncDelta(L(A), 3);
  assert.equal(d.diverged, true);
  assert.equal(d.append, "");
  assert.equal(d.total, 1);
});

test("reconcileSyncedLines: null remote → 0 (nothing synced yet)", () => {
  assert.equal(reconcileSyncedLines(L(A, B), null), 0);
});

test("reconcileSyncedLines: remote is an append-prefix → its line count", () => {
  assert.equal(reconcileSyncedLines(L(A, B, C), L(A, B)), 2);
  assert.equal(reconcileSyncedLines(L(A, B), L(A, B)), 2); // equal
});

test("reconcileSyncedLines: divergence (mismatch or remote ahead) → -1", () => {
  assert.equal(reconcileSyncedLines(L(A, B), L(A, C)), -1); // line 2 differs
  assert.equal(reconcileSyncedLines(L(A), L(A, B)), -1); // remote longer than local
});

test("planSync: missing page → create (offset = full count)", () => {
  assert.deepEqual(planSync({ exists: false, local: L(A, B), offset: null }), {
    kind: "create",
    offset: 2,
  });
});

test("planSync: full requested → full re-render", () => {
  assert.deepEqual(planSync({ exists: true, local: L(A, B), offset: 1, full: true }), {
    kind: "full",
    offset: 2,
  });
});

test("planSync: known offset with new lines → append the tail", () => {
  assert.deepEqual(planSync({ exists: true, local: L(A, B, C), offset: 1 }), {
    kind: "append",
    content: `${B}\n${C}`,
    offset: 3,
  });
});

test("planSync: known offset, nothing new → noop", () => {
  assert.deepEqual(planSync({ exists: true, local: L(A, B), offset: 2 }), { kind: "noop", offset: 2 });
});

test("planSync: unknown offset seeds from a remote append-prefix, then appends", () => {
  assert.deepEqual(planSync({ exists: true, local: L(A, B, C), offset: null, remote: L(A, B) }), {
    kind: "append",
    content: C,
    offset: 3,
  });
});

test("planSync: unknown offset, remote diverged → full re-render", () => {
  assert.deepEqual(planSync({ exists: true, local: L(A, B), offset: null, remote: L(A, C) }), {
    kind: "full",
    offset: 2,
  });
});

test("planSync: stale offset beyond local length (fork/truncation) → full re-render", () => {
  assert.deepEqual(planSync({ exists: true, local: L(A), offset: 5 }), { kind: "full", offset: 1 });
});
