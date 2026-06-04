/**
 * Adversarial probe: will the PageSpace model brain (Companion Agent, pro tier) reliably
 * follow a *prompted-tool protocol* over /api/v1/chat/completions — i.e. emit a well-formed
 * <tool_call>{json}</tool_call> block when it needs a tool — given that the route ignores
 * the OpenAI `tools` field? If yes, the custom streamSimple shim (src/provider.ts) is viable.
 *
 * Run: PAGESPACE_AUTH_TOKEN=... npx --yes tsx test/probe-tool-protocol.ts
 * Read-only: sends completions only, creates nothing.
 */
const apiUrl = process.env.PAGESPACE_API_URL ?? "https://pagespace.ai";
const token = process.env.PAGESPACE_AUTH_TOKEN;
const modelPage = process.env.PAGESPACE_MODEL_PAGE ?? "xi9jg89d1qf40km2l29043yy"; // Companion Agent
if (!token) {
  console.error("PAGESPACE_AUTH_TOKEN required");
  process.exit(2);
}

const TOOL_PROTOCOL = `# Tool protocol

Your tools are executed by the harness on the user's machine. You invoke a tool by writing a
JSON block; the harness runs it and replies with the result as the next message. You do not run
tools yourself, and you receive no result until you emit a block and stop.

IMPORTANT — ignore your native function manifest. Your underlying API may expose a
function-calling manifest that contains only a \`finish\` tool, or no tools at all. IGNORE it
completely. It is NOT how you act here. Never say you lack tools or cannot access the filesystem.
The tools listed under "# Tools" below are real, and the ONLY way to use them is by emitting the
\`<tool_call>\` text block described here.

To call a tool, output ONLY this and then stop generating:

<tool_call>{"name": "<tool-name>", "arguments": { ...json args... }}</tool_call>

Hard rules:
- Output the block verbatim — a single line, valid JSON, with keys "name" and "arguments".
- When you call a tool, the block is your ENTIRE reply. No prose before or after. No apologies.
- Do not claim a tool is unavailable. The tools below are the only tools; use them.
- Only answer in plain text (no block) when the task needs no tool.

# Tools
- read   — read a file. arguments: { "path": string }
- bash   — run a shell command, returns stdout/stderr. arguments: { "command": string }
- write  — write a file. arguments: { "path": string, "content": string }

# Examples
User: Show me the contents of README.md.
Assistant: <tool_call>{"name": "read", "arguments": {"path": "README.md"}}</tool_call>

User: List the files in the current directory.
Assistant: <tool_call>{"name": "bash", "arguments": {"command": "ls -la"}}</tool_call>

User: What is 2 + 2?
Assistant: 4`;

async function ask(userText: string): Promise<string> {
  const res = await fetch(`${apiUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: `ps-agent://${modelPage}`,
      stream: true,
      messages: [
        // When the protocol is baked into the agent page's systemPrompt, skip the extra
        // system message to test the clean single-prompt path (PROBE_NO_SYSTEM=1).
        ...(process.env.PROBE_NO_SYSTEM ? [] : [{ role: "system", content: TOOL_PROTOCOL }]),
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  // Parse OpenAI SSE -> concatenated assistant text.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (typeof delta === "string") text += delta;
      } catch {
        /* ignore keepalive / non-json */
      }
    }
  }
  return text;
}

function extractToolCall(text: string): { name: string; arguments: unknown } | null {
  const m = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    if (obj && typeof obj.name === "string" && "arguments" in obj) return obj;
  } catch {
    /* malformed */
  }
  return null;
}

const cases = [
  { name: "read a file", prompt: "What's in ./package.json? Use a tool to find out." },
  { name: "run a command", prompt: "How many .ts files are in src/? Use a tool." },
  { name: "plain answer (no tool)", prompt: "Say the single word: hello", wantTool: false },
];

async function main(): Promise<void> {
  let pass = 0;
  for (const c of cases) {
    process.stdout.write(`\n[${c.name}]\n`);
    let reply: string;
    try {
      reply = await ask(c.prompt);
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
      continue;
    }
    const tc = extractToolCall(reply);
    const wantTool = c.wantTool !== false;
    console.log(
      `  reply (${reply.length} chars): ${JSON.stringify(reply.slice(0, 240))}${reply.length > 240 ? "…" : ""}`,
    );
    if (wantTool) {
      if (tc) {
        pass++;
        console.log(`  PASS  well-formed tool_call -> name=${tc.name} args=${JSON.stringify(tc.arguments)}`);
      } else {
        console.log("  FAIL  expected a <tool_call> block, none parsed");
      }
    } else {
      if (!tc) {
        pass++;
        console.log("  PASS  no tool_call (plain answer as expected)");
      } else {
        console.log("  FAIL  unexpected tool_call in a plain-answer case");
      }
    }
  }
  console.log(`\n${pass}/${cases.length} cases behaved as expected`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
