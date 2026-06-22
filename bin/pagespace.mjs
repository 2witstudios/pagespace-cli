#!/usr/bin/env node
// Branded `pagespace` launcher. `pagespace status` runs a config/auth doctor; anything else starts
// pi with this package's extension preloaded and passes args through.
//
// Runtime: re-exec under tsx so the bin can import the shared TS source (src/doctor.ts etc.) —
// one implementation consumed by status, onboarding, and the unit tests (no mirroring). The preamble
// below detects plain node and re-spawns under tsx transparently.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Re-exec under tsx if running under plain node (so TS imports resolve on any Node version).
// The parent spawns the child under tsx and exits; the child (PAGESPACE_UNDER_TSX=1) runs main().
const isTsx = process.execArgv.some((a) => a.includes("tsx")) || !!process.env.PAGESPACE_UNDER_TSX;
if (!isTsx) {
  const bin = fileURLToPath(import.meta.url);
  const tsxPath = path.join(path.dirname(bin), "..", "node_modules", ".bin", "tsx");
  const child = spawn(process.execPath, [tsxPath, bin, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, PAGESPACE_UNDER_TSX: "1" },
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} else {
  // main() is called at the end of the file, after all declarations (avoids TDZ on consts).
}
// Shared pure modules — ONE implementation consumed by status + onboarding + login + tests.
// No mirroring: every function below calls these, not a local copy.
import { diagnose, formatDoctor } from "../src/doctor.ts";
import { nextOnboardingStep, initialOnboardingState, onboardingNeedsSetup } from "../src/onboarding.ts";
import { buildCredentialRecord, writeCredentials, readCredentials, credentialsPath } from "../src/credentials.ts";
import { resolveDefaultDrive, resolveAuthToken } from "../src/config.ts";
import { sanitizeChildEnv, SECRET_ENV_KEYS } from "../src/env.ts";

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

// Load credentials from the store (~/.pagespace/credentials, 0600) if no token is set via env/.env.
// The token enters the LAUNCHER's process.env here so loadConfig()/the provider can read it — but
// launchPi() strips it before spawning pi (token isolation). So the agent never sees it.
// Uses the shared readCredentials() from src/credentials.ts (enforces 0600, validates the record).
(function loadCredentials() {
  if (process.env.PAGESPACE_AUTH_TOKEN && process.env.PAGESPACE_AUTH_TOKEN.trim()) return;
  try {
    const rec = readCredentials();
    if (rec) {
      process.env.PAGESPACE_AUTH_TOKEN = rec.token;
      if (!process.env.PAGESPACE_API_URL) process.env.PAGESPACE_API_URL = rec.apiUrl;
    }
  } catch (err) {
    console.error(`pagespace: ${err.message}`);
    process.exit(1);
  }
})();

// Secret env keys stripped from the spawned pi process so pi's bash tool can never read them
// (token isolation — the agent must never see the PageSpace auth token). Shared via src/env.ts.
async function statusDoctor() {
  // Reusable doctor (src/doctor.ts): gathers inputs, calls diagnose(), prints structured results.
  // Non-interactive/CI-safe: never prompts; exit 1 on any failing check.
  const apiUrl = (process.env.PAGESPACE_API_URL || "https://pagespace.ai").replace(/\/$/, "");
  const hasCredentials = fs.existsSync(credentialsPath());
  const token = resolveAuthToken(process.env, () => {
    try {
      return readCredentials();
    } catch {
      return null;
    }
  });
  const hasToken = !!(token && token.trim());

  let reachable;
  let driveCount;
  if (hasToken) {
    try {
      const res = await fetch(`${apiUrl}/api/drives`, { headers: { authorization: `Bearer ${token}` } });
      reachable = res.ok;
      if (res.ok) {
        const data = await res.json().catch(() => []);
        driveCount = Array.isArray(data) ? data.length : Array.isArray(data?.drives) ? data.drives.length : 0;
      }
    } catch {
      reachable = false;
    }
  }

  // diagnose() + formatDoctor() are the shared pure doctor (src/doctor.ts) — same impl the unit
  // tests and onboarding consume. No mirroring. Non-interactive/CI-safe: exit 1 on any failing check.
  const result = diagnose({ apiUrl, hasToken, hasCredentials, reachable, driveCount });
  console.log(formatDoctor(result));
  if (!result.pass) process.exit(1);
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
  // Spawn pi with a SANITIZED env: strip secret keys (PAGESPACE_AUTH_TOKEN) so pi's bash tool and
  // any subprocess can NEVER read them via env/printenv/procfs. The provider reads the token from
  // config (not the child env) — token isolation (security ADR: agent must never see the token).
  const childEnv = sanitizeChildEnv(process.env);
  childEnv.PI_SKIP_VERSION_CHECK = "1";
  childEnv.PI_CODING_AGENT_DIR = PAGESPACE_AGENT_DIR;
  const child = spawn(process.execPath, [PI_CLI, "-e", extensionPath, ...noSkillsFlag, ...passthrough], {
    stdio: "inherit",
    env: childEnv,
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

async function loginCommand() {
  // pagespace login — interactive token capture → validate → persist to ~/.pagespace/credentials (0600).
  // The token never round-trips through .env or the shell env the agent sees (security ADR).
  process.stderr.write("pagespace · login\n");
  // Read the token from stdin as a normal line; it is written straight to the credential store,
  // never to .env and never to the spawned pi env.
  const readline = await import("node:readline/promises");
  const { stdin, stdout } = process;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let token;
  try {
    token = (await rl.question("Paste your PageSpace token: ")).trim();
  } finally {
    rl.close();
  }
  if (!token) {
    console.error("pagespace: no token entered — nothing saved.");
    process.exit(1);
  }
  const apiUrl = (process.env.PAGESPACE_API_URL || "https://pagespace.ai").replace(/\/$/, "");
  // Validate via an auth ping before persisting.
  try {
    const res = await fetch(`${apiUrl}/api/drives`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`pagespace: token rejected by ${apiUrl} (HTTP ${res.status}) — nothing saved.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`pagespace: cannot reach ${apiUrl} to validate (${err.message}) — nothing saved.`);
    process.exit(1);
  }
  // Build + write the record via the shared helpers (src/credentials.ts) — one impl, 0600 enforced.
  const rec = buildCredentialRecord({ token, apiUrl });
  const credPath = writeCredentials(rec);
  process.stderr.write(`pagespace · token saved to ${credPath} (0600). Run: pagespace status\n`);
}

// Drive the full first-run onboarding flow (token → validate → drives → models → default → materialize)
// using the shared pure state machine (src/onboarding.ts nextOnboardingStep). Each step performs its
// effect, feeds the result into nextOnboardingStep, and loops until done. No local state logic —
// the machine is the single implementation the unit tests exercise. Materialize via shared helpers.
async function runOnboarding() {
  let state = initialOnboardingState();
  const base = (process.env.PAGESPACE_API_URL || "https://pagespace.ai").replace(/\/$/, "");

  // STEP token: capture.
  process.stderr.write("pagespace · first run — let's get you set up.\n");
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let token;
  try { token = (await rl.question("Paste your PageSpace token: ")).trim(); } finally { rl.close(); }
  if (!token) { console.error("pagespace: no token entered — nothing saved."); process.exit(1); }
  state = nextOnboardingStep(state, { token });

  // STEP validate: auth ping. On failure this is a terminal condition — the caller exits. (The
  // machine only advances validate→drives on success; there is no recovery branch, so we don't
  // call nextOnboardingStep with validated:false.)
  const preferred = resolveDefaultDrive(process.env);
  try {
    const res = await fetch(`${base}/api/drives`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`pagespace: token rejected by ${base} (HTTP ${res.status}).`);
      process.exit(1);
    }
    state = nextOnboardingStep(state, { validated: true });
  } catch (err) {
    console.error(`pagespace: cannot reach ${base} (${err.message}).`);
    process.exit(1);
  }

  // STEP drives: discover accessible drives. Pass preferredDrive so the machine picks a default
  // consistent with the drive used for preferred-first model ordering.
  const drivesRaw = await fetch(`${base}/api/drives`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => []);
  const drives = (Array.isArray(drivesRaw) ? drivesRaw : drivesRaw?.drives || []).map((d) => ({ id: d.id, name: d.name, slug: d.slug }));
  if (drives.length === 0) { console.error("pagespace: no drives accessible to this token."); process.exit(1); }
  console.log(`  ✓ discovered ${drives.length} drive(s): ${drives.map((d) => d.slug).join(", ")}`);
  state = nextOnboardingStep(state, { drives, preferredDrive: preferred });

  // STEP models: discover agent pages across all drives (preferred/default drive first).
  const orderPreferred = state.defaultDrive ?? drives[0].slug;
  const ordered = [...drives].sort((a, b) => (a.slug === orderPreferred ? -1 : b.slug === orderPreferred ? 1 : 0));
  const modelRes = await Promise.allSettled(ordered.map((d) =>
    fetch(`${base}/api/drives/${d.id}/pages`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())
  ));
  const models = [];
  const walk = (nodes) => { for (const n of nodes) { if (n.type === "AI_CHAT") models.push({ id: n.id, name: n.title }); if (n.children) walk(n.children); } };
  for (const r of modelRes) if (r.status === "fulfilled" && Array.isArray(r.value)) walk(r.value);
  console.log(`  ✓ discovered ${models.length} agent model(s)${models.length ? ": " + models.map((m) => m.name).join(", ") : ""}`);
  state = nextOnboardingStep(state, { models });

  // STEP default → done (the machine advances automatically; the default is the first discovered).
  state = nextOnboardingStep(state);

  // Materialize: persist token to the credential store (shared writeCredentials). Set non-secret
  // drive/model defaults in the launcher env. The token does NOT go into env here — loadCredentials()
  // will read it from the store on the next launch (token isolation holds: no env round-trip).
  const credPath = writeCredentials(buildCredentialRecord({ token, apiUrl: base }));
  if (state.defaultDrive) process.env.PAGESPACE_DRIVE = state.defaultDrive;
  const allModels = state.models ?? [];
  if (allModels.length > 0) process.env.PAGESPACE_MODEL_PAGES = allModels.map((m) => m.id).join(",");
  console.log(`  ✓ drive: ${state.defaultDrive || "(none)"}`);
  if (allModels.length > 0) {
    console.log(`  ✓ ${allModels.length} agent model(s): ${allModels.map((m) => m.name).join(", ")}`);
  } else {
    console.log("  · no agent models found — set PAGESPACE_MODEL_PAGES manually if needed.");
  }
  process.stderr.write(`pagespace · set up complete (${credPath}, 0600). Launching…\n`);
}

/** No token anywhere (env, .env, credential store) → run first-run onboarding instead of a hard exit.
 * Uses the shared onboardingNeedsSetup() (src/onboarding.ts → diagnose()) — single decision path. */
function needsOnboarding() {
  const hasToken = !!(process.env.PAGESPACE_AUTH_TOKEN && process.env.PAGESPACE_AUTH_TOKEN.trim());
  const hasCredentials = fs.existsSync(credentialsPath());
  return onboardingNeedsSetup({ hasToken, hasCredentials });
}

async function main() {
  const sub = process.argv[2];
  if (sub === "status" || process.argv.includes("--check")) {
    statusDoctor();
  } else if (sub === "sessions") {
    sessionsCommand();
  } else if (sub === "resume") {
    resumeCommand(process.argv[3], process.argv.slice(4));
  } else if (sub === "login") {
    loginCommand();
  } else if (needsOnboarding()) {
    // First run with no token: walk the user to a coding-ready state (Cursor-grade) instead of exiting.
    await runOnboarding();
    launchPi(process.argv.slice(2));
  } else {
    launchPi(process.argv.slice(2));
  }
}

// Entry point — run after all declarations are initialized (avoids TDZ on module-level consts).
// Only the tsx child reaches here (PAGESPACE_UNDER_TSX=1); the plain-node parent spawns + exits above.
if (isTsx) main();
