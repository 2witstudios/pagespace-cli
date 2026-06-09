import { test } from "node:test";
import assert from "node:assert/strict";
import { textFromContent, extractEntryInput, formatSessionEntry } from "../../src/persistence.ts";

test("textFromContent handles string and content-block arrays", () => {
  assert.equal(textFromContent("hello"), "hello");
  assert.equal(
    textFromContent([
      { type: "text", text: "a" },
      { type: "toolCall", name: "read" },
      { type: "text", text: "b" },
    ]),
    "ab",
  );
  assert.equal(textFromContent(undefined), "");
});

test("extractEntryInput pulls the last user request, final answer, and tool-call count", () => {
  const input = extractEntryInput([
    { role: "user", content: "first" },
    { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
    { role: "toolResult", content: "..." },
    { role: "user", content: "do the thing" },
    {
      role: "assistant",
      content: [
        { type: "toolCall", name: "bash" },
        { type: "text", text: "done" },
      ],
    },
  ]);
  assert.ok(input);
  assert.equal(input!.request, "do the thing");
  assert.equal(input!.summary, "done");
  assert.equal(input!.toolCalls, 2);
  assert.deepEqual(input!.files, []);
});

test("extractEntryInput collects deduplicated file paths from read/write/edit tool calls", () => {
  const input = extractEntryInput([
    { role: "user", content: "update the config" },
    {
      role: "assistant",
      content: [
        { type: "toolCall", name: "read", arguments: { path: "src/config.ts" } },
        { type: "toolCall", name: "edit", arguments: { file_path: "src/config.ts" } },
        { type: "toolCall", name: "read", arguments: { path: "src/config.ts" } },
        { type: "toolCall", name: "bash", arguments: { command: "npm test" } },
        { type: "toolCall", name: "edit", arguments: { file_path: "test/config.test.ts" } },
        { type: "text", text: "done" },
      ],
    },
  ]);
  assert.ok(input);
  assert.equal(input!.toolCalls, 5);
  assert.deepEqual(input!.files, ["src/config.ts", "test/config.test.ts"]);
});

test("extractEntryInput returns null when there's nothing loggable", () => {
  assert.equal(extractEntryInput([]), null);
  assert.equal(extractEntryInput([{ role: "toolResult", content: "x" }]), null);
});

test("formatSessionEntry renders a concise one-line entry", () => {
  const line = formatSessionEntry("2026-06-04 21:40", {
    request: "implement the thing",
    summary: "shipped it",
    toolCalls: 3,
    files: [],
  });
  assert.equal(line, '- _2026-06-04 21:40_ — pi: "implement the thing" · 3 tool calls · → shipped it');
});

test("formatSessionEntry omits tool count and summary when absent, and clips long text", () => {
  const line = formatSessionEntry("t", { request: "x".repeat(200), summary: "", toolCalls: 0, files: [] });
  assert.match(line, /^- _t_ — pi: "x{120}…"$/);
});

test("formatSessionEntry singularizes one tool call", () => {
  const line = formatSessionEntry("t", { request: "r", summary: "", toolCalls: 1, files: [] });
  assert.match(line, /1 tool call(?!s)/);
});

test("formatSessionEntry includes files between request and tool count", () => {
  const line = formatSessionEntry("t", {
    request: "refactor",
    summary: "",
    toolCalls: 4,
    files: ["src/a.ts", "src/b.ts"],
  });
  assert.equal(line, '- _t_ — pi: "refactor" · [src/a.ts, src/b.ts] · 4 tool calls');
});

test("formatSessionEntry truncates files list beyond 5 with overflow count", () => {
  const line = formatSessionEntry("t", {
    request: "big refactor",
    summary: "",
    toolCalls: 10,
    files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"],
  });
  assert.match(line, /\[a\.ts, b\.ts, c\.ts, d\.ts, e\.ts \+2\]/);
});
