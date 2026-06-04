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
  });
  assert.equal(line, '- _2026-06-04 21:40_ — pi: "implement the thing" · 3 tool calls · → shipped it');
});

test("formatSessionEntry omits tool count and summary when absent, and clips long text", () => {
  const line = formatSessionEntry("t", { request: "x".repeat(200), summary: "", toolCalls: 0 });
  assert.match(line, /^- _t_ — pi: "x{120}…"$/);
});

test("formatSessionEntry singularizes one tool call", () => {
  const line = formatSessionEntry("t", { request: "r", summary: "", toolCalls: 1 });
  assert.match(line, /1 tool call(?!s)/);
});
