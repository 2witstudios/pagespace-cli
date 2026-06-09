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

test("toOpenAIMessages: assistant tool call → tool_calls with stringified args + rich annotation", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "x.ts" } }],
    },
  ]);
  assert.equal(out[0].role, "assistant");
  assert.equal(out[0].content, "[read: x.ts]");
  assert.deepEqual(out[0].tool_calls, [
    { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"x.ts"}' } },
  ]);
});

test("toOpenAIMessages: tool-call-only — edit uses file_path arg", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "edit", arguments: { file_path: "src/foo.ts" } }],
    },
  ]);
  assert.equal(out[0].content, "[edit: src/foo.ts]");
});

test("toOpenAIMessages: tool-call-only — bash truncates long commands", () => {
  const cmd = "npm run typecheck && npm run lint && npm test";
  const out = msgs([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: cmd } }],
    },
  ]);
  assert.ok(out[0].content?.startsWith("[bash: "));
  assert.ok(out[0].content?.endsWith("…]"));
  assert.ok((out[0].content?.length ?? 0) <= 50);
});

test("toOpenAIMessages: tool-call-only — multiple calls deduplicated by name+arg", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
        { type: "toolCall", id: "c2", name: "edit", arguments: { file_path: "b.ts" } },
        { type: "toolCall", id: "c3", name: "read", arguments: { path: "a.ts" } },
      ],
    },
  ]);
  assert.equal(out[0].content, "[read: a.ts, edit: b.ts]");
  assert.equal(out[0].tool_calls?.length, 3);
});

test("toOpenAIMessages: tool-call-only — unknown tool with no primary arg falls back to name only", () => {
  const out = msgs([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "pagespace_status", arguments: {} }],
    },
  ]);
  assert.equal(out[0].content, "[pagespace_status]");
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

test("registerPageSpaceProvider: pi model id is display name when config.models is set", () => {
  const calls: any[] = [];
  const pi = { registerProvider: (_name: string, cfg: any) => calls.push(cfg) };
  const config = {
    apiUrl: "https://pagespace.ai",
    authToken: "mcp_x",
    defaultDriveSlug: "pagespace-cli",
    mountPrefix: "pagespace",
    modelPageId: "agent_a",
    models: [
      { id: "agent_a", name: "Agent Alpha" },
      { id: "agent_b", name: "Agent Beta" },
    ],
  };

  const out = registerPageSpaceProvider(pi as any, config as any);
  assert.deepEqual(out.modelIds, ["Agent Alpha", "Agent Beta"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].models.map((m: any) => m.id),
    ["Agent Alpha", "Agent Beta"],
  );
});

test("registerPageSpaceProvider: falls back to generated name when config.models is absent", () => {
  const calls: any[] = [];
  const pi = { registerProvider: (_name: string, cfg: any) => calls.push(cfg) };
  const config = {
    apiUrl: "https://pagespace.ai",
    authToken: "mcp_x",
    defaultDriveSlug: "pagespace-cli",
    mountPrefix: "pagespace",
    modelPageId: "agent_a",
  };

  const out = registerPageSpaceProvider(pi as any, config as any);
  assert.deepEqual(out.modelIds, ["PageSpace Brain"]);
  assert.deepEqual(
    calls[0].models.map((m: any) => m.id),
    ["PageSpace Brain"],
  );
});
