/**
 * Live end-to-end test of the PageSpace model provider (src/provider.ts) against the real
 * /api/v1/chat/completions route, using a brain agent page configured with a capable model.
 *
 * Run: PAGESPACE_AUTH_TOKEN=... PAGESPACE_MODEL_PAGE=<agentPageId> npx --yes tsx test/run-provider.ts
 * Read-only on the drive (completions only); creates/trashes nothing.
 */
import { Type } from "typebox";
import type { Context, Message, Model } from "@earendil-works/pi-ai";
import { createPageSpaceStreamSimple } from "../src/provider.ts";

const apiUrl = process.env.PAGESPACE_API_URL ?? "https://pagespace.ai";
const authToken = process.env.PAGESPACE_AUTH_TOKEN;
const modelPageId = process.env.PAGESPACE_MODEL_PAGE;
if (!authToken || !modelPageId) {
  console.error("PAGESPACE_AUTH_TOKEN and PAGESPACE_MODEL_PAGE are required");
  process.exit(2);
}

const streamSimple = createPageSpaceStreamSimple({
  apiUrl,
  authToken,
  defaultDriveSlug: "pagespace-cli",
  mountPrefix: "pagespace",
  modelPageId,
});

const model = { api: "openai-completions", provider: "pagespace", id: modelPageId } as unknown as Model<any>;

const TOOLS = [
  {
    name: "read",
    description: "Read a file from the local repo.",
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    name: "bash",
    description: "Run a shell command; returns stdout/stderr.",
    parameters: Type.Object({ command: Type.String() }),
  },
];

const systemPrompt =
  "You are the reasoning model for pagespace-cli. Work in small, verified steps; never guess file contents.";

interface Drained {
  text: string;
  toolCalls: { name: string; arguments: any }[];
  stopReason: string;
  events: string[];
}

async function drain(context: Context): Promise<Drained> {
  const stream = streamSimple(model, context, { apiKey: authToken });
  const out: Drained = { text: "", toolCalls: [], stopReason: "", events: [] };
  for await (const ev of stream) {
    out.events.push(ev.type);
    if (ev.type === "text_delta") out.text += ev.delta;
    else if (ev.type === "toolcall_end")
      out.toolCalls.push({ name: ev.toolCall.name, arguments: ev.toolCall.arguments });
    else if (ev.type === "done") out.stopReason = ev.reason;
    else if (ev.type === "error") out.stopReason = `error:${ev.error.errorMessage}`;
  }
  return out;
}

let pass = 0;
let total = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  total++;
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  // Case A: a task that needs a tool -> expect a parsed tool call, stopReason toolUse, no hang.
  console.log("\n[A] tool call");
  const a = await drain({
    systemPrompt,
    tools: TOOLS,
    messages: [
      { role: "user", content: "Read ./package.json and tell me the name field.", timestamp: Date.now() },
    ],
  });
  console.log(`  events: ${a.events.join(",")}`);
  console.log(`  toolCalls: ${JSON.stringify(a.toolCalls)}`);
  ok("A: exactly one tool call", a.toolCalls.length === 1);
  ok("A: tool is read or bash", ["read", "bash"].includes(a.toolCalls[0]?.name), a.toolCalls[0]?.name);
  ok("A: stopReason toolUse", a.stopReason === "toolUse");
  ok("A: no hallucinated text leaked as a text block before the call", !/my-app|sample Node/i.test(a.text));

  // Case B: multi-turn — feed a tool result back; the model should continue (answer or next call).
  console.log("\n[B] tool-result follow-up");
  const priorCall = a.toolCalls[0] ?? { name: "read", arguments: { path: "./package.json" } };
  const b = await drain({
    systemPrompt,
    tools: TOOLS,
    messages: [
      { role: "user", content: "Read ./package.json and tell me the name field.", timestamp: Date.now() },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: priorCall.name, arguments: priorCall.arguments }],
        api: "openai-completions",
        provider: "pagespace",
        model: modelPageId,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      } as Message,
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: priorCall.name,
        content: [{ type: "text", text: '{ "name": "pagespace-cli", "version": "0.0.1" }' }],
        isError: false,
        timestamp: Date.now(),
      } as Message,
    ],
  });
  console.log(`  text: ${JSON.stringify(b.text.slice(0, 200))}`);
  console.log(`  toolCalls: ${JSON.stringify(b.toolCalls)}`);
  ok(
    "B: mentions the real name from the tool result",
    /pagespace-cli/.test(b.text + JSON.stringify(b.toolCalls)),
  );
  ok("B: terminated cleanly", b.stopReason === "stop" || b.stopReason === "toolUse");

  // Case C: a plain question -> text answer, stopReason stop, no tool call.
  console.log("\n[C] plain answer");
  const c = await drain({
    systemPrompt,
    tools: TOOLS,
    messages: [{ role: "user", content: "Reply with exactly the word: pong", timestamp: Date.now() }],
  });
  console.log(`  text: ${JSON.stringify(c.text)}`);
  ok("C: no tool call", c.toolCalls.length === 0);
  ok("C: stopReason stop", c.stopReason === "stop");
  ok("C: said pong", /pong/i.test(c.text));

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
