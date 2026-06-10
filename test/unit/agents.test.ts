import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectAgentPages,
  dedupeAgentNames,
  orderDrivesPreferredFirst,
  type Drive,
  type Page,
} from "../../src/api.ts";

const page = (id: string, title: string, type: string, children?: Page[]): Page => ({
  id,
  title,
  type,
  parentId: null,
  children,
});

test("collectAgentPages: finds AI_CHAT pages at any depth, in tree order, titles as names", () => {
  const tree: Page[] = [
    page("a", "Top Agent", "AI_CHAT"),
    page("f", "Folder", "FOLDER", [
      page("doc", "Doc", "DOCUMENT"),
      page("b", "Nested Agent", "AI_CHAT", [page("c", "Deep Agent", "AI_CHAT")]),
    ]),
  ];
  assert.deepEqual(collectAgentPages(tree), [
    { id: "a", name: "Top Agent" },
    { id: "b", name: "Nested Agent" },
    { id: "c", name: "Deep Agent" },
  ]);
});

test("collectAgentPages: no agents → empty list", () => {
  assert.deepEqual(collectAgentPages([page("d", "Doc", "DOCUMENT")]), []);
});

test("orderDrivesPreferredFirst: preferred drive moves to front, others keep order", () => {
  const drives: Drive[] = [
    { id: "1", name: "A", slug: "a" },
    { id: "2", name: "B", slug: "b" },
    { id: "3", name: "C", slug: "c" },
  ];
  assert.deepEqual(
    orderDrivesPreferredFirst(drives, "b").map((d) => d.slug),
    ["b", "a", "c"],
  );
  // No preference (or unknown slug) → unchanged order, original array untouched.
  assert.deepEqual(
    orderDrivesPreferredFirst(drives).map((d) => d.slug),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    orderDrivesPreferredFirst(drives, "zzz").map((d) => d.slug),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    drives.map((d) => d.slug),
    ["a", "b", "c"],
  );
});

test("dedupeAgentNames: duplicate names get a short id suffix; unique names untouched", () => {
  const agents = [
    { id: "abcdefgh1234", name: "Curator" },
    { id: "ijklmnop5678", name: "Curator" },
    { id: "qrstuvwx9012", name: "Writer" },
  ];
  assert.deepEqual(dedupeAgentNames(agents), [
    { id: "abcdefgh1234", name: "Curator (abcdefgh)" },
    { id: "ijklmnop5678", name: "Curator (ijklmnop)" },
    { id: "qrstuvwx9012", name: "Writer" },
  ]);
});
