import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildPiArgs,
  parseJsonModeOutput,
  runViaCommand,
  currentDepth,
  childEnv,
} from "../../src/subagent.ts";

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "subagent-stub.mjs");

test("buildPiArgs assembles json-mode child args with the task last", () => {
  assert.deepEqual(buildPiArgs("do x"), ["--mode", "json", "-p", "--no-session", "Task: do x"]);
  assert.deepEqual(buildPiArgs("do x", { model: "pagespace/abc", tools: ["read", "bash"] }), [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--model",
    "pagespace/abc",
    "--tools",
    "read,bash",
    "Task: do x",
  ]);
});

test("parseJsonModeOutput extracts the final assistant text, turns, and tool calls", () => {
  const ndjson = [
    JSON.stringify({ type: "message_end", message: { role: "user", content: "hi" } }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "read" },
          { type: "text", text: "step 1" },
        ],
        stopReason: "toolUse",
      },
    }),
    "not json — ignore me",
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }], stopReason: "stop" },
    }),
  ].join("\n");
  const r = parseJsonModeOutput(ndjson);
  assert.equal(r.text, "final answer");
  assert.equal(r.turns, 2);
  assert.equal(r.toolCalls, 1);
  assert.equal(r.stopReason, "stop");
});

test("parseJsonModeOutput tolerates empty/garbage input", () => {
  assert.deepEqual(parseJsonModeOutput(""), { text: "", turns: 0, toolCalls: 0 });
  assert.deepEqual(parseJsonModeOutput("garbage\n{bad json"), { text: "", turns: 0, toolCalls: 0 });
});

test("depth guard: childEnv increments PAGESPACE_SUBAGENT_DEPTH", () => {
  assert.equal(currentDepth({}), 0);
  assert.equal(currentDepth({ PAGESPACE_SUBAGENT_DEPTH: "1" }), 1);
  assert.equal(childEnv({}).PAGESPACE_SUBAGENT_DEPTH, "1");
  assert.equal(childEnv({ PAGESPACE_SUBAGENT_DEPTH: "1" }).PAGESPACE_SUBAGENT_DEPTH, "2");
});

test("runViaCommand spawns a child and parses its json-mode output (stub, no model)", async () => {
  const r = await runViaCommand(process.execPath, [STUB, "hello sub"]);
  assert.equal(r.text, "echo: hello sub");
  assert.equal(r.turns, 1);
  assert.equal(r.stopReason, "stop");
});

test("runViaCommand surfaces a nonzero exit as an error", async () => {
  const r = await runViaCommand(process.execPath, [STUB, "--fail"]);
  assert.ok(r.errorMessage, "expected an errorMessage on failure");
});
