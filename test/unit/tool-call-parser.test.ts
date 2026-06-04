import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolCallParser, tryExtractFirstJsonObject, type ParsedSegment } from "../../src/tool-call-parser.ts";

const TOOLS = ["read", "bash", "write"];

/** Feed `text` to a parser split into `size`-char chunks; return all segments + the parser. */
function run(text: string, size = text.length): { segs: ParsedSegment[]; parser: ToolCallParser } {
  const parser = new ToolCallParser(TOOLS);
  const segs: ParsedSegment[] = [];
  for (let i = 0; i < text.length; i += size) {
    segs.push(...parser.feed(text.slice(i, i + size)));
  }
  segs.push(...parser.flush());
  return { segs, parser };
}

const text = (segs: ParsedSegment[]): string =>
  segs
    .filter((s) => s.type === "text")
    .map((s) => (s as any).delta)
    .join("");
const calls = (segs: ParsedSegment[]) => segs.filter((s) => s.type === "toolCall") as any[];

test("plain text yields no tool call", () => {
  const { segs, parser } = run("Just a normal answer with no tools.");
  assert.equal(calls(segs).length, 0);
  assert.equal(text(segs), "Just a normal answer with no tools.");
  assert.equal(parser.finished, false);
});

test("wrapped tool call in one chunk", () => {
  const { segs, parser } = run(`<tool_call>{"name":"read","arguments":{"path":"a.ts"}}</tool_call>`);
  const c = calls(segs);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], { type: "toolCall", name: "read", arguments: { path: "a.ts" } });
  assert.equal(parser.finished, true);
  assert.equal(text(segs), ""); // nothing before the wrapper
});

test("wrapped tool call split across many tiny chunks", () => {
  const { segs } = run(`<tool_call>{"name":"bash","arguments":{"command":"ls -la"}}</tool_call>`, 1);
  const c = calls(segs);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].arguments, { command: "ls -la" });
});

test("bare JSON whose name is a real tool is a tool call", () => {
  const { segs } = run(`{"name":"read","arguments":{"path":"x"}}`);
  assert.deepEqual(calls(segs)[0], { type: "toolCall", name: "read", arguments: { path: "x" } });
});

test("prose preamble before a bare tool call streams as text, then the call", () => {
  const { segs } = run(`Let me read that file: {"name":"read","arguments":{"path":"x"}}`);
  assert.equal(calls(segs).length, 1);
  assert.equal(text(segs), "Let me read that file: ");
});

test("bare JSON whose name is NOT a tool stays text", () => {
  const s = `Here is some config: {"name":"frobnicate","arguments":{}} done`;
  const { segs, parser } = run(s);
  assert.equal(calls(segs).length, 0);
  assert.equal(parser.finished, false);
  assert.equal(text(segs), s);
});

test("prose braces never misfire", () => {
  const s = "The set is {a, b, c} and a map {x: 1}.";
  const { segs } = run(s);
  assert.equal(calls(segs).length, 0);
  assert.equal(text(segs), s);
});

test("hallucinated tail after a tool call is ignored", () => {
  const parser = new ToolCallParser(TOOLS);
  const segs = [...parser.feed(`<tool_call>{"name":"read","arguments":{"path":"a"}}</tool_call>`)];
  assert.equal(parser.finished, true);
  // The model keeps generating a fake result — must be dropped.
  const more = parser.feed("\n\nHere is the content of a:\n...lots of hallucinated text...");
  assert.equal(more.length, 0);
  assert.equal(calls(segs).length, 1);
});

test("split open-marker is held back, not emitted as text", () => {
  const parser = new ToolCallParser(TOOLS);
  const a = parser.feed("<tool_"); // partial marker
  assert.equal(text(a), ""); // nothing emitted yet
  const b = parser.feed(`call>{"name":"read","arguments":{"path":"a"}}</tool_call>`);
  assert.equal(calls(b).length, 1);
});

test("text with a brace split across chunks classifies correctly once enough arrives", () => {
  // "{" arrives at end of one chunk; classification waits, then resolves to a tool call.
  const parser = new ToolCallParser(TOOLS);
  const out: ParsedSegment[] = [];
  out.push(...parser.feed("answer: {"));
  out.push(...parser.feed(`"name":"bash","arguments":{"command":"pwd"}}`));
  const c = calls(out);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].arguments, { command: "pwd" });
  assert.equal(text(out), "answer: ");
});

test("arguments default to {} when omitted", () => {
  const { segs } = run(`{"name":"read"}`);
  // bare object starting with "name" → classified; name is a tool → call with empty args.
  assert.deepEqual(calls(segs)[0], { type: "toolCall", name: "read", arguments: {} });
});

test("tryExtractFirstJsonObject handles nested braces and strings with braces", () => {
  const r = tryExtractFirstJsonObject(`prefix {"a": {"b": "}{"}, "c": 1} suffix`);
  assert.ok(r);
  assert.deepEqual(r!.value, { a: { b: "}{" }, c: 1 });
});

test("tryExtractFirstJsonObject returns null on incomplete input", () => {
  assert.equal(tryExtractFirstJsonObject(`{"name":"read", "argum`), null);
});
