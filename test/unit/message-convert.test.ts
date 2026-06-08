import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromConversationMessages } from "../../src/provider.ts";
import type { ConvMessage } from "../../src/provider.ts";

describe("fromConversationMessages", () => {
  it("user-only round-trip", () => {
    const input: ConvMessage[] = [{ id: "m1", role: "user", content: "hello", created_at: 1_000 }];
    const out = fromConversationMessages(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, "user");
    assert.deepEqual((out[0] as any).content, [{ type: "text", text: "hello" }]);
    assert.equal((out[0] as any).timestamp, 1_000_000);
  });

  it("assistant with no tool calls", () => {
    const input: ConvMessage[] = [{ id: "m1", role: "assistant", content: "hi there", created_at: 2_000 }];
    const out = fromConversationMessages(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, "assistant");
    assert.deepEqual((out[0] as any).content, [{ type: "text", text: "hi there" }]);
    assert.equal((out[0] as any).stopReason, "stop");
  });

  it("assistant with tool calls emits toolResult placeholders", () => {
    const input: ConvMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_abc", type: "function", function: { name: "read", arguments: '{"path":"foo.ts"}' } },
        ],
        created_at: 3_000,
      },
    ];
    const out = fromConversationMessages(input);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, "assistant");
    assert.equal((out[0] as any).stopReason, "toolUse");
    const tc = (out[0] as any).content[0];
    assert.equal(tc.type, "toolCall");
    assert.equal(tc.id, "call_abc");
    assert.equal(tc.name, "read");
    assert.deepEqual(tc.arguments, { path: "foo.ts" });
    assert.equal(out[1].role, "toolResult");
    assert.equal((out[1] as any).toolCallId, "call_abc");
    assert.equal((out[1] as any).isError, false);
  });

  it("multi-turn conversation", () => {
    const input: ConvMessage[] = [
      { id: "m1", role: "user", content: "list files", created_at: 1_000 },
      {
        id: "m2",
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tc1", type: "function", function: { name: "ls", arguments: "{}" } }],
        created_at: 2_000,
      },
      { id: "m3", role: "user", content: "thanks", created_at: 3_000 },
      { id: "m4", role: "assistant", content: "done", created_at: 4_000 },
    ];
    const out = fromConversationMessages(input);
    // user, assistant+toolResult placeholder, user, assistant
    assert.equal(out.length, 5);
    assert.equal(out[0].role, "user");
    assert.equal(out[1].role, "assistant");
    assert.equal(out[2].role, "toolResult");
    assert.equal(out[3].role, "user");
    assert.equal(out[4].role, "assistant");
  });

  it("opts.provider and opts.modelId propagate to assistant messages", () => {
    const input: ConvMessage[] = [{ id: "m1", role: "assistant", content: "hi", created_at: 1_000 }];
    const out = fromConversationMessages(input, { provider: "myprovider", modelId: "mymodel" });
    assert.equal((out[0] as any).provider, "myprovider");
    assert.equal((out[0] as any).model, "mymodel");
  });

  it("malformed tool_calls arguments fall back to empty object", () => {
    const input: ConvMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tc1", type: "function", function: { name: "foo", arguments: "NOT_JSON" } }],
        created_at: 1_000,
      },
    ];
    const out = fromConversationMessages(input);
    const tc = (out[0] as any).content[0];
    assert.deepEqual(tc.arguments, {});
  });
});
