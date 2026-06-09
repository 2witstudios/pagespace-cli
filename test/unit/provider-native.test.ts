import { test } from "node:test";
import assert from "node:assert/strict";
import { convertTools, toOpenAIMessages, registerPageSpaceProvider } from "../../src/provider.ts";

// pi Message/Tool shapes are constructed loosely here; the helpers only read role/content/parameters.
const msgs = (arr: unknown[]) => toOpenAIMessages(arr as Parameters<typeof toOpenAIMessages>[0]);

test("toOpenAIMessages: user text → role:user", () => {
  assert.deepEqual(msgs([{ role: "user", content: [{ type: "text", text: "hello" }] }]), [
    { role: "user", content: "hello" },
  ]);
});

test("toOpenAIMessages: assistant text only → role:assistant content", () => {
  assert.deepEqual(msgs([{ role: "assistant", content: [{ type: "text", text: "hi there" }] }]), [
    { role: "assistant", content: "hi there" },
  ]);
});

test("toOpenAIMessages: assistant tool call → tool_calls with stringified args + annotation content", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "x.ts" } }],
    },
  ]);
  assert.equal(out[0].role, "assistant");
  assert.equal(out[0].content, "[read]");
  assert.deepEqual(out[0].tool_calls, [
    { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"x.ts"}' } },
  ]);
});

test("toOpenAIMessages: tool-call-only with multiple distinct names → deduped annotation", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "c1", name: "read", arguments: {} },
        { type: "toolCall", id: "c2", name: "edit", arguments: {} },
        { type: "toolCall", id: "c3", name: "read", arguments: {} },
      ],
    },
  ]);
  assert.equal(out[0].content, "[read, edit]");
  assert.equal(out[0].tool_calls?.length, 3);
});

test("toOpenAIMessages: assistant text + parallel tool calls", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [
        { type: "text", text: "doing two things" },
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
        { type: "toolCall", id: "c2", name: "bash", arguments: { command: "ls" } },
      ],
    },
  ]);
  assert.equal(out[0].content, "doing two things");
  assert.equal(out[0].tool_calls?.length, 2);
  assert.equal(out[0].tool_calls?.[1].function.name, "bash");
});

test("toOpenAIMessages: toolResult → role:tool with tool_call_id", () => {
  assert.deepEqual(
    msgs([
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file body" }],
        isError: false,
      },
    ]),
    [{ role: "tool", tool_call_id: "c1", content: "file body" }],
  );
});

test("toOpenAIMessages: error tool result still role:tool", () => {
  const out = msgs([
    {
      role: "toolResult",
      toolCallId: "c2",
      toolName: "bash",
      content: [{ type: "text", text: "boom" }],
      isError: true,
    },
  ]);
  assert.equal(out[0].role, "tool");
  assert.equal(out[0].tool_call_id, "c2");
  assert.match(out[0].content ?? "", /^Error: boom/);
});

test("convertTools: maps to OpenAI function tool shape", () => {
  const params = { type: "object", properties: { path: { type: "string" } } };
  const out = convertTools([{ name: "read", description: "read a file", parameters: params }] as Parameters<
    typeof convertTools
  >[0]);
  assert.deepEqual(out, [
    { type: "function", function: { name: "read", description: "read a file", parameters: params } },
  ]);
});

test("convertTools: empty → empty", () => {
  assert.deepEqual(convertTools([]), []);
});

test("registerPageSpaceProvider: registers one model per configured agent id", () => {
  const calls: any[] = [];
  const pi = { registerProvider: (_name: string, cfg: any) => calls.push(cfg) };
  const config = {
    apiUrl: "https://pagespace.ai",
    authToken: "mcp_x",
    defaultDriveSlug: "pagespace-cli",
    mountPrefix: "pagespace",
    modelPageId: "agent_a",
    modelPageIds: ["agent_a", "agent_b"],
  };

  const out = registerPageSpaceProvider(pi as any, config as any);
  assert.deepEqual(out.modelIds, ["agent_a", "agent_b"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].models.map((m: any) => m.id),
    ["agent_a", "agent_b"],
  );
});
