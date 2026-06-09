/**
 * PageSpace model brain for pi — a custom `streamSimple` over `POST /api/v1/chat/completions`
 * (model `ps-agent://<pageId>`, OpenAI SSE) using **native function-calling**. The whole agentic
 * tool loop stays in pi:
 *
 *   1. We send pi's tools as an OpenAI `tools` array plus `disable_server_tools: true` — the v1
 *      route's client-only mode (PageSpace #1559): the model is handed ONLY pi's tools, the agent
 *      page's server-side tools and the forced `finish` tool are off, and tool calls are returned
 *      to us instead of executed server-side.
 *   2. The model streams native `delta.tool_calls[]` fragments (id + name, arguments concatenated,
 *      keyed by `index`); we accumulate them and emit pi `toolCall` events so pi runs each tool
 *      locally. Tool results go back as native `role:"tool"` messages (see `toOpenAIMessages`).
 *   3. The route stops the step at the tool call (`finish_reason: "tool_calls"`) — no text-protocol
 *      parsing, no hallucinated tail, no abort hack. Plain answers stream as `delta.content`.
 *
 * (Superseded the prompted-tool TEXT shim once the route accepted client `tools` — PageSpace #1559.)
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

/** Extract the most informative single argument from a tool call for annotation purposes. */
function primaryArg(name: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "read":
    case "find":
    case "ls":
      return s(args.path);
    case "write":
    case "edit":
      return s(args.file_path);
    case "grep":
      return s(args.pattern) || s(args.path);
    case "bash": {
      const cmd = s(args.command);
      return cmd.length > 40 ? `${cmd.slice(0, 37)}…` : cmd;
    }
    default:
      return "";
  }
}

/**
 * Convert pi's message history into OpenAI-native chat messages for the v1 client-tools mode:
 * assistant turns carry `tool_calls` (arguments stringified), tool results become `role:"tool"`
 * messages keyed by `tool_call_id` (errors prefixed so the model can tell a failed call). Pure.
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
      if (!text && toolCalls.length > 0) {
        // Tool-call-only step: annotate with tool names + primary arg so the message is visible
        // in the PageSpace conversation history instead of storing content:null (blank entry).
        const entries = toolCalls.map((tc) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {}
          const key = primaryArg(tc.function.name, args);
          return key ? `${tc.function.name}: ${key}` : tc.function.name;
        });
        text = `[${[...new Set(entries)].join(", ")}]`;
      }
      const msg: OpenAIMessage = { role: "assistant" };
      if (text) msg.content = text;
      if (toolCalls.length) msg.tool_calls = toolCalls;
      if (msg.content !== undefined || msg.tool_calls) out.push(msg);
    } else if (m.role === "toolResult") {
      const body = textOf(m.content);
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.isError ? `Error: ${body}` : body });
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

/** OpenAI-format message as stored by GET /api/v1/conversations/:id. */
export interface ConvMessage {
  id: string;
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  /** Present on role:"tool" messages returned by the back-fill path (PR #1572). */
  tool_call_id?: string;
  created_at: number;
}

/**
 * Convert stored OpenAI messages (from GET /api/v1/conversations/:id) back to pi Message[].
 *
 * The endpoint now returns interleaved role:"tool" messages for stored results (backend PR #1572).
 * When they are present they are used as-is. When they are absent (messages stored before the back-fill
 * landed, or a turn whose back-fill hasn't run yet) we emit "(result not stored)" placeholders so
 * pi's history stays structurally valid. Pure, no side effects.
 */
export function fromConversationMessages(
  messages: ConvMessage[],
  opts: { provider?: string; modelId?: string } = {},
): Message[] {
  const out: Message[] = [];
  const emptyUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  // After an assistant message with tool_calls, track which call IDs still need a result.
  // Flushed as placeholders when we reach a message that isn't role:"tool".
  interface PendingCall {
    id: string;
    name: string;
    ts: number;
  }
  const pending: PendingCall[] = [];
  const covered = new Set<string>();
  // tool_call_id → tool name, populated from the preceding assistant's tool_calls
  const nameMap = new Map<string, string>();

  const flushPending = () => {
    for (const p of pending) {
      if (!covered.has(p.id)) {
        out.push({
          role: "toolResult",
          toolCallId: p.id,
          toolName: p.name,
          content: [{ type: "text", text: "(result not stored)" }],
          isError: false,
          timestamp: p.ts,
        });
      }
    }
    pending.length = 0;
    covered.clear();
  };

  for (const m of messages) {
    const ts = m.created_at * 1000;

    if (m.role === "user") {
      flushPending();
      out.push({ role: "user", content: [{ type: "text", text: m.content ?? "" }], timestamp: ts });
    } else if (m.role === "assistant") {
      flushPending();
      const content: (TextContent | ToolCall)[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      const toolCalls = m.tool_calls ?? [];
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // keep empty args on malformed JSON
        }
        content.push({ type: "toolCall", id: tc.id, name: tc.function.name, arguments: args });
        pending.push({ id: tc.id, name: tc.function.name, ts });
        nameMap.set(tc.id, tc.function.name);
      }
      if (content.length > 0) {
        out.push({
          role: "assistant",
          content,
          api: "openai-completions",
          provider: opts.provider ?? "pagespace",
          model: opts.modelId ?? "",
          usage: emptyUsage,
          stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
          timestamp: ts,
        } as AssistantMessage);
      }
    } else if (m.role === "tool") {
      const toolCallId = m.tool_call_id ?? "";
      if (!nameMap.has(toolCallId)) continue; // orphan — no preceding assistant registered this id
      covered.add(toolCallId);
      out.push({
        role: "toolResult",
        toolCallId,
        toolName: nameMap.get(toolCallId) ?? "",
        content: [{ type: "text", text: m.content ?? "" }],
        isError: false,
        timestamp: ts,
      });
    }
  }
  flushPending();
  return out;
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

    // Internal abort: propagates pi's outer cancellation to the upstream fetch.
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

      // Native tool calls stream as OpenAI `delta.tool_calls[]` fragments keyed by `index`:
      // id + function.name arrive in the first fragment, function.arguments are concatenated across
      // fragments. We accumulate, then emit pi tool-call events once at the end (supports parallel calls).
      const toolAcc = new Map<number, { id: string; name: string; args: string }>();
      let toolSeq = 0;
      const emitToolCalls = (): void => {
        for (const index of [...toolAcc.keys()].sort((a, b) => a - b)) {
          const acc = toolAcc.get(index);
          if (!acc) continue;
          let args: Record<string, any> = {};
          try {
            args = acc.args ? JSON.parse(acc.args) : {};
          } catch {
            // malformed argument JSON — keep the call with empty args rather than dropping it
          }
          const toolCall: ToolCall = {
            type: "toolCall",
            id: acc.id || `ps_${Date.now().toString(36)}_${toolSeq++}`,
            name: acc.name,
            arguments: args,
          };
          const ci = blocks.push(toolCall) - 1;
          stream.push({ type: "toolcall_start", contentIndex: ci, partial: output });
          stream.push({ type: "toolcall_delta", contentIndex: ci, delta: acc.args || "{}", partial: output });
          stream.push({ type: "toolcall_end", contentIndex: ci, toolCall, partial: output });
        }
        if (toolAcc.size > 0) output.stopReason = "toolUse";
      };

      try {
        const oaMessages = toOpenAIMessages(context.messages);
        const messages = context.systemPrompt?.trim()
          ? [{ role: "system", content: context.systemPrompt.trim() }, ...oaMessages]
          : oaMessages;
        // Client-only native function-calling: hand the model pi's own tools and turn off the agent
        // page's server-side tools (+ the forced `finish` tool) — pi runs the loop locally.
        const body: Record<string, unknown> = {
          model: toAgentModel(model.id),
          stream: true,
          messages,
          disable_server_tools: true,
        };
        if (config.conversationId) {
          body.conversation_id = config.conversationId;
          body.client_manages_history = true;
        }
        const tools = convertTools(context.tools ?? []);
        if (tools.length > 0) body.tools = tools;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
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
            const delta = json.choices?.[0]?.delta;
            if (typeof delta?.content === "string" && delta.content.length > 0) emitText(delta.content);
            if (Array.isArray(delta?.tool_calls)) {
              for (const call of delta.tool_calls) {
                const index = typeof call.index === "number" ? call.index : 0;
                const acc = toolAcc.get(index) ?? { id: "", name: "", args: "" };
                if (typeof call.id === "string" && call.id) acc.id = call.id;
                if (typeof call.function?.name === "string" && call.function.name)
                  acc.name = call.function.name;
                if (typeof call.function?.arguments === "string") acc.args += call.function.arguments;
                toolAcc.set(index, acc);
              }
            }
          }
        }
        try {
          await reader.cancel();
        } catch {
          /* already closed/aborted */
        }

        endText();
        emitToolCalls();
        if (toolAcc.size === 0) output.stopReason = "stop";
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
        const aborted = internalAbort.signal.aborted && !!outerSignal?.aborted;
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

/** Register the PageSpace brain as a pi provider + one or more models (agent pages). */
export function registerPageSpaceProvider(
  pi: { registerProvider: (name: string, config: any) => void },
  config: PageSpaceConfig,
  spec: PageSpaceModelSpec = {},
): { providerName: string; modelIds: string[] } {
  const providerName = "pagespace";
  const modelIds = config.modelPageIds ?? (config.modelPageId ? [config.modelPageId] : []);
  pi.registerProvider(providerName, {
    name: "PageSpace",
    baseUrl: `${config.apiUrl.replace(/\/$/, "")}/api/v1`,
    apiKey: config.authToken,
    api: "openai-completions",
    streamSimple: createPageSpaceStreamSimple(config),
    models: modelIds.map((id) => ({
      id,
      name: modelIds.length > 1 ? `PageSpace Brain (${id.slice(0, 8)})` : (spec.name ?? "PageSpace Brain"),
      reasoning: false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: spec.contextWindow ?? 200_000,
      maxTokens: spec.maxTokens ?? 8192,
    })),
  });
  return { providerName, modelIds };
}
