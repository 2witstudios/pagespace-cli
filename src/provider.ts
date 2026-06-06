/**
 * PageSpace model brain for pi — a custom `streamSimple` over `POST /api/v1/chat/completions`
 * (model `ps-agent://<pageId>`, OpenAI SSE). The whole agentic tool loop stays in pi:
 *
 *   1. The v1 route now accepts client `tools`. The companion currently keeps a
 *      **prompted-tool protocol** for deterministic, model-agnostic behavior: the shim injects
 *      pi's real tool manifest + a strict output format into the system prompt; the model replies
 *      with a `<tool_call>{json}</tool_call>` text block; the shim parses it back into a pi
 *      `toolCall` so pi executes it locally.
 *   2. The route always injects a `finish` tool into the model's native manifest, which makes a
 *      capable model think `finish` is its only tool — so the protocol carries an explicit
 *      "ignore your native manifest" override (validated against claude-sonnet-4.6 via openrouter;
 *      glm-5 is too weak to follow the protocol reliably).
 *   3. The model emits the block and then keeps generating (it hallucinates a fake result). We
 *      parse the FIRST complete tool block and ABORT the HTTP stream — the route bills tokens
 *      burned so far and stops cleanly (its consumer-abort path), so the hallucinated tail costs
 *      almost nothing and never reaches pi.
 *
 * Dependency-free: raw fetch + manual SSE parse, types from `@earendil-works/pi-ai`.
 */
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  TextContent,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { PageSpaceConfig } from "./config.ts";
import { CLOSE, OPEN, ToolCallParser } from "./tool-call-parser.ts";

/** Strip a `ps-agent://` prefix if present; the page id is what the route wants after the prefix. */
function toAgentModel(modelId: string): string {
  const id = modelId.startsWith("ps-agent://") ? modelId.slice("ps-agent://".length) : modelId;
  return `ps-agent://${id}`;
}

function textOf(content: string | (TextContent | { type: string })[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is TextContent => (c as TextContent).type === "text")
    .map((c) => c.text)
    .join("");
}

/** Serialize an assistant turn (text + tool calls) back into the prompted-tool wire form. */
function serializeAssistant(message: Extract<Message, { role: "assistant" }>): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "toolCall") {
      parts.push(`${OPEN}${JSON.stringify({ name: block.name, arguments: block.arguments })}${CLOSE}`);
    }
    // thinking blocks are dropped — they are not replayed to the model
  }
  return parts.join("\n").trim();
}

/** OpenAI-style chat message (native function-calling wire form). */
export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** OpenAI-style tool/function definition sent in the request `tools` array. */
export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/**
 * Convert pi's message history into OpenAI-native chat messages for the v1 client-tools mode:
 * assistant turns carry `tool_calls` (arguments stringified), tool results become `role:"tool"`
 * messages keyed by `tool_call_id`. Pure. (Replaces the prompted-tool `toV1Messages` text form.)
 */
export function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: textOf(m.content) });
    } else if (m.role === "assistant") {
      let text = "";
      const toolCalls: NonNullable<OpenAIMessage["tool_calls"]> = [];
      for (const block of m.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.arguments ?? {}) },
          });
        }
        // thinking blocks are dropped — not replayed to the model
      }
      text = text.trim();
      const msg: OpenAIMessage = { role: "assistant" };
      if (text) msg.content = text;
      if (toolCalls.length) msg.tool_calls = toolCalls;
      if (msg.content !== undefined || msg.tool_calls) out.push(msg);
    } else if (m.role === "toolResult") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: textOf(m.content) });
    }
  }
  return out;
}

/** Convert pi's tool manifest into OpenAI function tool definitions. Pure. */
export function convertTools(tools: Tool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Convert pi's message history into the v1 `{role, content}` shape (text-only route). */
function toV1Messages(context: Context): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  for (const m of context.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: textOf(m.content) });
    } else if (m.role === "assistant") {
      const text = serializeAssistant(m);
      if (text) out.push({ role: "assistant", content: text });
    } else if (m.role === "toolResult") {
      // The route has no native tool-call to attach a `tool` message to (we sent the call as
      // text), so feed the result back as the next user turn — exactly what the protocol promises.
      const body = textOf(m.content);
      const tag = m.isError ? "ERROR" : "result";
      out.push({
        role: "user",
        content: `Tool ${tag} for ${m.toolName} (call ${m.toolCallId}):\n${body}`,
      });
    }
  }
  return out;
}

/** The prompted-tool protocol + the live pi tool manifest, injected as a leading system message. */
function buildSystemText(context: Context): string {
  const sections: string[] = [];
  if (context.systemPrompt?.trim()) sections.push(context.systemPrompt.trim());

  sections.push(`# Tool protocol

Your tools are executed by the harness on the user's machine. To use one, write a JSON block; the
harness runs it and sends the result back as the next message. You never run tools yourself, and
you get no result until you emit a block and stop.

IMPORTANT — ignore your native function manifest. Your underlying API may expose a function-calling
manifest containing only a \`finish\` tool, or no tools at all. IGNORE it completely; it is NOT how
you act here. Never say you lack tools or cannot access the filesystem. The tools listed under
"# Tools" below are real, and the ONLY way to use them is by emitting the \`<tool_call>\` block.

CRITICAL — you do NOT already know the answer. You do NOT have the contents of any file, the state
of the codebase, or the output of any command — not from the workspace/drive context, not from
memory. If a request is about a file, the code, the filesystem, or a command's output, your FIRST
action MUST be a tool call, even if you believe you know the answer. Guessing is a failure.

To call a tool, output ONLY this and then stop generating:

${OPEN}{"name": "<tool-name>", "arguments": { ...json args... }}${CLOSE}

Hard rules:
- One line, valid JSON, keys "name" and "arguments". When you call a tool the block is your ENTIRE
  reply — no prose before or after, no apologies, and do NOT invent the result; stop and wait.
- Never claim a tool is unavailable. Never answer a question about a file, the code, or a command
  from memory or the workspace context — emit a tool call first.
- Answer in plain text (no block) only for questions that need no file, code, or command at all.`);

  const tools = context.tools ?? [];
  if (tools.length > 0) {
    const manifest = tools
      .map((t) => `- ${t.name} — ${t.description}\n  arguments schema: ${JSON.stringify(t.parameters)}`)
      .join("\n");
    sections.push(`# Tools\n${manifest}`);
  }

  // Few-shot — anchors weaker models on the exact wire format. Uses the common pi tool names.
  sections.push(`# Examples
User: Show me the contents of README.md.
Assistant: ${OPEN}{"name": "read", "arguments": {"path": "README.md"}}${CLOSE}

User: How many TypeScript files are in src/?
Assistant: ${OPEN}{"name": "bash", "arguments": {"command": "find src -name '*.ts' | wc -l"}}${CLOSE}

User: What is 2 + 2?
Assistant: 4`);

  return sections.join("\n\n");
}

/** Build the custom streamSimple bound to a PageSpace config. */
export function createPageSpaceStreamSimple(config: PageSpaceConfig) {
  const endpoint = `${config.apiUrl.replace(/\/$/, "")}/api/v1/chat/completions`;

  return function streamSimple(
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();

    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    // Internal abort: trip it once we've parsed a tool call so the route stops generating.
    const internalAbort = new AbortController();
    const onOuterAbort = () => internalAbort.abort();
    const outerSignal = options?.signal;
    if (outerSignal) {
      if (outerSignal.aborted) internalAbort.abort();
      else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }

    (async () => {
      const apiKey = options?.apiKey ?? config.authToken;
      // --- text/tool streaming state ---
      let textBlock: TextContent | null = null;
      const blocks = output.content as (TextContent | ToolCall)[];
      const idxOf = (b: TextContent | ToolCall) => blocks.indexOf(b);
      const ensureText = (): TextContent => {
        if (!textBlock) {
          textBlock = { type: "text", text: "" };
          blocks.push(textBlock);
          stream.push({ type: "text_start", contentIndex: idxOf(textBlock), partial: output });
        }
        return textBlock;
      };
      const emitText = (delta: string) => {
        if (!delta) return;
        const b = ensureText();
        b.text += delta;
        stream.push({ type: "text_delta", contentIndex: idxOf(b), delta, partial: output });
      };
      const endText = () => {
        if (!textBlock) return;
        stream.push({
          type: "text_end",
          contentIndex: idxOf(textBlock),
          content: textBlock.text,
          partial: output,
        });
        textBlock = null;
      };

      // Parse the prompted-tool protocol out of the streamed text (src/tool-call-parser.ts):
      // accepts a `<tool_call>` block or a bare `{"name":…}` whose name is a real tool.
      const parser = new ToolCallParser((context.tools ?? []).map((t) => t.name));
      let toolCall: ToolCall | null = null;
      let toolSeq = 0;

      // Apply parser segments to the pi event stream. Returns true once a tool call is emitted
      // (caller then stops reading + aborts the upstream).
      const applySegments = (segs: ReturnType<ToolCallParser["feed"]>): boolean => {
        for (const seg of segs) {
          if (seg.type === "text") {
            emitText(seg.delta);
            continue;
          }
          endText();
          toolCall = {
            type: "toolCall",
            id: `ps_${Date.now().toString(36)}_${toolSeq++}`,
            name: seg.name,
            arguments: seg.arguments as Record<string, any>,
          };
          const ci = blocks.push(toolCall) - 1;
          stream.push({ type: "toolcall_start", contentIndex: ci, partial: output });
          stream.push({
            type: "toolcall_delta",
            contentIndex: ci,
            delta: JSON.stringify(toolCall.arguments),
            partial: output,
          });
          stream.push({ type: "toolcall_end", contentIndex: ci, toolCall, partial: output });
          output.stopReason = "toolUse";
          return true;
        }
        return false;
      };

      try {
        const messages = [{ role: "system", content: buildSystemText(context) }, ...toV1Messages(context)];
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: toAgentModel(model.id), stream: true, messages }),
          signal: internalAbort.signal,
        });
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          throw new Error(`PageSpace v1 HTTP ${res.status}: ${detail.slice(0, 500)}`);
        }

        stream.push({ type: "start", partial: output });

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let sse = "";
        let done = false;
        let usageSeen: { input?: number; output?: number } | null = null;

        outer: while (!done) {
          const { value, done: rdDone } = await reader.read();
          if (rdDone) break;
          sse += dec.decode(value, { stream: true });
          const lines = sse.split("\n");
          sse = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") {
              done = true;
              break outer;
            }
            let json: any;
            try {
              json = JSON.parse(payload);
            } catch {
              continue; // keepalive / non-JSON
            }
            if (json.usage)
              usageSeen = { input: json.usage.prompt_tokens, output: json.usage.completion_tokens };
            const delta: string | undefined = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              if (applySegments(parser.feed(delta))) {
                done = true;
                internalAbort.abort(); // stop the route from billing the hallucinated tail
                break outer;
              }
            }
          }
        }
        try {
          await reader.cancel();
        } catch {
          /* already closed/aborted */
        }

        if (!toolCall) {
          // Plain answer: flush any held-back tail, close the text block.
          applySegments(parser.flush());
          endText();
          output.stopReason = "stop";
        }
        if (usageSeen) {
          output.usage.input = usageSeen.input ?? 0;
          output.usage.output = usageSeen.output ?? 0;
          output.usage.totalTokens = output.usage.input + output.usage.output;
        }
        stream.push({
          type: "done",
          reason: output.stopReason as "stop" | "length" | "toolUse",
          message: output,
        });
        stream.end();
      } catch (err) {
        const aborted = internalAbort.signal.aborted && !toolCall && !!outerSignal?.aborted;
        // An internal abort *after* a tool call is success, not error — but that path returns via
        // the `done` push above, so reaching here with a toolCall means the abort raced the finalize.
        if (toolCall) {
          stream.push({ type: "done", reason: "toolUse", message: output });
          stream.end();
          return;
        }
        output.stopReason = aborted ? "aborted" : "error";
        output.errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({ type: "error", reason: output.stopReason, error: output });
        stream.end();
      } finally {
        if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
      }
    })();

    return stream;
  };
}

export interface PageSpaceModelSpec {
  /** Display name shown in pi's model picker. */
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** Register the PageSpace brain as a pi provider + a single model (the configured agent page). */
export function registerPageSpaceProvider(
  pi: { registerProvider: (name: string, config: any) => void },
  config: PageSpaceConfig,
  spec: PageSpaceModelSpec = {},
): { providerName: string; modelId: string } {
  const providerName = "pagespace";
  const modelId = config.modelPageId ?? "";
  pi.registerProvider(providerName, {
    name: "PageSpace",
    baseUrl: `${config.apiUrl.replace(/\/$/, "")}/api/v1`,
    apiKey: config.authToken,
    api: "openai-completions",
    streamSimple: createPageSpaceStreamSimple(config),
    models: [
      {
        id: modelId,
        name: spec.name ?? "PageSpace Brain",
        reasoning: false,
        input: ["text"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: spec.contextWindow ?? 200_000,
        maxTokens: spec.maxTokens ?? 8192,
      },
    ],
  });
  return { providerName, modelId };
}
