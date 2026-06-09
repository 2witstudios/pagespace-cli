#!/usr/bin/env node
// Branded `pagespace` launcher. `pagespace status` runs a config/auth doctor; anything else starts
// pi with this package's extension preloaded and passes args through. Mirrors src/cli.ts
// (buildPiLaunchArgs/resolveExtensionPath/checkConfig — kept in TS for unit tests).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the pi CLI from the local workspace package rather than a global install.
// Using a path-relative URL since dist/cli.js isn't in the package's exports map.
const PI_CLI = fileURLToPath(
  new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);
/** Reproduce pi's cwd → session-dir name: `--<cwd without leading slash, / \\ : → ->--`. */
const encodeCwdDir = (cwd) => `--${cwd.replace(/^[\/\\]/, "").replace(/[\/\\:]/g, "-")}--`;

const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extensions", "pagespace.ts");

// Source PAGESPACE_* from the nearest .env/.env.local (shell env wins) so `pagespace status` and the
// spawned pi see the same config. Mirrors src/env.ts (kept here in plain JS — the bin has no TS loader).
function loadDotenv(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".env")) || fs.existsSync(path.join(dir, ".env.local"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
  for (const file of [".env.local", ".env"]) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2];
      const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
      if (quoted) v = v.slice(1, -1);
      else {
        const h = v.indexOf(" #");
        if (h !== -1) v = v.slice(0, h);
        v = v.trim();
      }
      if (process.env[m[1]] === undefined || process.env[m[1]] === "") process.env[m[1]] = v;
    }
  }
}
loadDotenv();

const CONFIG_KEYS = [
  ["PAGESPACE_AUTH_TOKEN", true, "scoped MCP token (Bearer)"],
  ["PAGESPACE_API_URL", false, "instance URL (default https://pagespace.ai)"],
  ["PAGESPACE_DRIVE", false, "default drive slug (mount + memory)"],
  ["PAGESPACE_MODEL_PAGE", false, "brain agent page id (ps-agent://<id>)"],
  ["PAGESPACE_MODEL_PAGES", false, "comma-separated brain agent ids for /model toggling"],
];

async function statusDoctor() {
  console.log("pagespace config:");
  let missingRequired = false;
  for (const [key, required, label] of CONFIG_KEYS) {
    const set = !!(process.env[key] && process.env[key].trim());
    if (!set && required) missingRequired = true;
    console.log(`  ${set ? "✓" : required ? "✗" : "·"} ${key}${set ? "" : ` (unset — ${label})`}`);
  }
  if (missingRequired) {
    console.log("  → copy .mcp.json.example to .mcp.json and set your token, or export the env vars.");
    process.exit(1);
  }
  const url = (process.env.PAGESPACE_API_URL || "https://pagespace.ai").replace(/\/$/, "");
  const token = process.env.PAGESPACE_AUTH_TOKEN;
  try {
    const res = await fetch(`${url}/api/drives`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.log(`  ✗ auth ping ${url}: HTTP ${res.status} — check the token/permissions.`);
      process.exit(1);
    }
    const data = await res.json().catch(() => []);
    const n = Array.isArray(data) ? data.length : Array.isArray(data?.drives) ? data.drives.length : "?";
    console.log(`  ✓ reachable: ${url} — ${n} drive(s) visible to this token.`);
  } catch (err) {
    console.log(`  ✗ cannot reach ${url}: ${err.message}`);
    process.exit(1);
  }
}

// Launch pi with the extension preloaded + --no-skills (skills are registered as /name extension
// commands by the extension itself, so pi's built-in /skill:name registration isn't needed).
// Pagespace's own pi agent directory — separate from ~/.pi/agent/ so pagespace can own its
// keybindings without touching the user's global pi config.
const PAGESPACE_AGENT_DIR = path.join(os.homedir(), ".pagespace", "agent");
function ensurePagespaceAgentDir() {
  if (!fs.existsSync(PAGESPACE_AGENT_DIR)) {
    fs.mkdirSync(PAGESPACE_AGENT_DIR, { recursive: true });
  }
  const keybindingsPath = path.join(PAGESPACE_AGENT_DIR, "keybindings.json");
  // Unbind app.thinking.cycle from shift+tab so pagespace can claim shift+tab for
  // agent cycling. pi's RESERVED list blocks extension overrides — the only escape
  // hatch is clearing the binding via the user keybindings config before pi starts.
  if (!fs.existsSync(keybindingsPath)) {
    fs.writeFileSync(keybindingsPath, JSON.stringify({ "app.thinking.cycle": [] }, null, 2) + "\n");
  }
  // Lock the model picker to the pagespace provider so no other provider's models appear.
  const settingsPath = path.join(PAGESPACE_AGENT_DIR, "settings.json");
  const existing = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
  if (!existing.allowedProviders || existing.allowedProviders.join(",") !== "pagespace") {
    fs.writeFileSync(settingsPath, JSON.stringify({ ...existing, allowedProviders: ["pagespace"] }, null, 2) + "\n");
  }
}

function launchPi(passthrough) {
  ensurePagespaceAgentDir();
  const quiet = passthrough.includes("-p") || passthrough.includes("--print") || passthrough.includes("--mode");
  if (!quiet) process.stderr.write("pagespace · the PageSpace coding harness\n");
  const noSkillsFlag =
    passthrough.includes("--no-skills") || passthrough.includes("-ns") || passthrough.includes("--skill")
      ? []
      : ["--no-skills"];
  const child = spawn(process.execPath, [PI_CLI, "-e", extensionPath, ...noSkillsFlag, ...passthrough], {
    stdio: "inherit",
    env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_CODING_AGENT_DIR: PAGESPACE_AGENT_DIR },
  });
  child.on("error", (err) => {
    console.error(`pagespace: failed to launch (${err.message}).`);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}


function apiCfg() {
  const base = (process.env.PAGESPACE_API_URL || "https://pagespace.ai").replace(/\/$/, "");
  const token = process.env.PAGESPACE_AUTH_TOKEN;
  const drive = process.env.PAGESPACE_DRIVE;
  const agent = process.env.PAGESPACE_MODEL_PAGE;
  const missing = [];
  if (!token) missing.push("PAGESPACE_AUTH_TOKEN");
  if (!drive) missing.push("PAGESPACE_DRIVE");
  if (!agent) missing.push("PAGESPACE_MODEL_PAGE");
  if (missing.length) {
    console.error(`pagespace: session commands need ${missing.join(", ")} (set them in .env.local).`);
    process.exit(1);
  }
  return { base, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, drive, agent };
}
async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
async function listAgentConversations(cfg) {
  const r = await getJson(`${cfg.base}/api/ai/page-agents/${cfg.agent}/conversations`, cfg.headers);
  return r.conversations ?? [];
}
async function getConversation(id, cfg) {
  return getJson(`${cfg.base}/api/v1/conversations/${id}`, cfg.headers);
}

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function fromConvMessages(messages, { provider = "pagespace", modelId = "" } = {}) {
  const out = [];
  for (const m of messages) {
    const ts = (m.created_at ?? 0) * 1000;
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.content ?? "" }], timestamp: ts });
    } else if (m.role === "assistant") {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      const toolCalls = m.tool_calls ?? [];
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}
        content.push({ type: "toolCall", id: tc.id, name: tc.function.name, arguments: args });
      }
      if (content.length > 0) {
        out.push({ role: "assistant", content, api: "openai-completions", provider, model: modelId, usage: EMPTY_USAGE, stopReason: toolCalls.length > 0 ? "toolUse" : "stop", timestamp: ts });
      }
      for (const tc of toolCalls) {
        out.push({ role: "toolResult", toolCallId: tc.id, toolName: tc.function.name, content: [{ type: "text", text: "(result not stored)" }], isError: false, timestamp: ts });
      }
    }
  }
  return out;
}
function randHex8() { return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0"); }
function buildResumeJsonl(convId, messages, { cwd, provider, modelId } = {}) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push(JSON.stringify({ type: "session", version: 3, id: convId, timestamp: now, cwd: cwd || process.cwd() }));
  const mcId = randHex8();
  lines.push(JSON.stringify({ type: "model_change", id: mcId, parentId: null, timestamp: now, provider: provider || "pagespace", modelId: modelId || "" }));
  let prevId = mcId;
  for (const msg of fromConvMessages(messages, { provider, modelId })) {
    const id = randHex8();
    const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : now;
    lines.push(JSON.stringify({ type: "message", id, parentId: prevId, timestamp: ts, message: msg }));
    prevId = id;
  }
  return lines.join("\n") + "\n";
}

async function sessionsCommand() {
  const cfg = apiCfg();
  try {
    const convs = await listAgentConversations(cfg);
    if (!convs.length) {
      console.log("No conversations yet. Start a pagespace session and it will appear here.");
      return;
    }
    console.log("Conversations (resume with: pagespace resume <id>):\n");
    for (const c of convs) {
      const updated = new Date(c.updatedAt).toLocaleString();
      console.log(`  ${c.id}  ${updated}  ${c.preview || ""}`);
    }
  } catch (err) {
    console.error(`pagespace: ${err.message}`);
    process.exit(1);
  }
}

async function resumeCommand(ref, rest) {
  if (!ref) {
    console.error("usage: pagespace resume <conversation-id>   (list with: pagespace sessions)");
    process.exit(1);
  }
  const cfg = apiCfg();
  try {
    const convs = await listAgentConversations(cfg);
    const exact = convs.find((c) => c.id === ref);
    const candidates = convs.filter((c) => c.id.startsWith(ref));
    const match = exact || (candidates.length === 1 ? candidates[0] : undefined);
    if (!match) {
      if (candidates.length > 1) {
        console.error(`pagespace: "${ref}" is ambiguous — use a longer id:`);
        for (const c of candidates) console.error(`  ${c.id}`);
      } else {
        console.error(`pagespace: no conversation matching "${ref}". Try: pagespace sessions`);
      }
      process.exit(1);
    }
    const conv = await getConversation(match.id, cfg);
    if (!conv.messages?.length) {
      console.error("pagespace: that conversation has no messages to resume.");
      process.exit(1);
    }
    const cwd = process.cwd();
    const dir = process.env.PI_CODING_AGENT_SESSION_DIR
      ? process.env.PI_CODING_AGENT_SESSION_DIR
      : path.join(os.homedir(), ".pi", "agent", "sessions", encodeCwdDir(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(dir, `${ts}_${match.id}.jsonl`);
    fs.writeFileSync(dest, buildResumeJsonl(match.id, conv.messages, { cwd, provider: "pagespace", modelId: cfg.agent }));
    process.stderr.write(`pagespace · resuming conversation ${match.id.slice(0, 8)} (${match.preview || match.id})\n`);
    launchPi(["--session", match.id, ...rest]);
  } catch (err) {
    console.error(`pagespace: ${err.message}`);
    process.exit(1);
  }
}

const sub = process.argv[2];
if (sub === "status" || process.argv.includes("--check")) {
  statusDoctor();
} else if (sub === "sessions") {
  sessionsCommand();
} else if (sub === "resume") {
  resumeCommand(process.argv[3], process.argv.slice(4));
} else {
  launchPi(process.argv.slice(2));
}
