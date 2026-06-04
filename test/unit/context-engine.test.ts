import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInjectedContext, DEFAULT_CONTEXT_PAGES } from "../../src/context-engine.ts";

test("empty sections produce an empty string (safe to append unconditionally)", () => {
  assert.equal(formatInjectedContext([]), "");
  assert.equal(formatInjectedContext([{ source: "Vision", content: "   " }]), "");
});

test("renders each section in a labelled context block with a header", () => {
  const out = formatInjectedContext([
    { source: "Vision", content: "Be PageSpace-native." },
    { source: "Epics/_index", content: "Epic 1: done" },
  ]);
  assert.match(out, /# PageSpace drive context \(injected, authoritative\)/);
  assert.match(out, /<pagespace_context source="Vision">\nBe PageSpace-native\.\n<\/pagespace_context>/);
  assert.match(out, /<pagespace_context source="Epics\/_index">\nEpic 1: done\n<\/pagespace_context>/);
});

test("drops empty-content sections but keeps the rest", () => {
  const out = formatInjectedContext([
    { source: "Vision", content: "north star" },
    { source: "_index", content: "" },
  ]);
  assert.match(out, /source="Vision"/);
  assert.doesNotMatch(out, /source="_index"/);
});

test("Vision is the first/primary injected page", () => {
  assert.equal(DEFAULT_CONTEXT_PAGES[0], "Vision");
});
