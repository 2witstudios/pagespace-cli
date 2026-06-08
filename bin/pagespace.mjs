#!/usr/bin/env node
// Branded `pagespace` launcher. `pagespace status` runs a config/auth doctor; anything else starts
// pi with this package's extension preloaded and passes args through. Mirrors src/cli.ts
// (buildPiLaunchArgs/resolveExtensionPath/checkConfig — kept in TS for unit tests).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeCwdDir,
  extractJsonl,
  parseHeader,
  resolveSessionRef,
  SESSIONS_FOLDER,
  sessionIdFromTitle,
} from "./session-read.mjs";

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

// Self-contained skills: pi should load ONLY this package's vendored PageSpace-AIDD skills, never the
// user-global (~/.agents/skills) set. `--no-skills` disables all auto-discovered + package skills; we
// then re-add exactly our own with one `--skill <dir>` each. Skipped if the user manages skills via
// their own flags.
const skillsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");
function vendoredSkillFlags() {
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const flags = [];
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, "SKILL.md"))) {
      flags.push("--skill", path.join(skillsDir, e.name));
    }
  }
  return flags;
}

// Launch pi with the extension + vendored skills preloaded, then the passthrough args. Reused by the
// default path and by `resume` (which adds `--session <id>`).
function launchPi(passthrough) {
  const quiet = passthrough.includes("-p") || passthrough.includes("--print") || passthrough.includes("--mode");
  if (!quiet) process.stderr.write("pagespace · the PageSpace coding harness\n");
  const userManagesSkills =
    passthrough.includes("--no-skills") || passthrough.includes("-ns") || passthrough.includes("--skill");
  const skillFlags = userManagesSkills ? [] : ["--no-skills", ...vendoredSkillFlags()];
  const child = spawn("pi", ["-e", extensionPath, ...skillFlags, ...passthrough], { stdio: "inherit" });
  child.on("error", (err) => {
    console.error(
      `pagespace: failed to launch pi (${err.message}). Is pi installed?  npm i -g @earendil-works/pi-coding-agent`,
    );
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
function findNode(nodes, id) {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}
// Resolve the agent's `Sessions` folder children → [{pageId, id, title}]. Returns [] if none.
// Titles lead with the FULL session id (`<id> · <preview>`) — see src/session-sync.ts.
async function remoteSessions(cfg) {
  const drives = await getJson(`${cfg.base}/api/drives`, cfg.headers);
  const list = Array.isArray(drives) ? drives : (drives?.drives ?? []);
  const drive = list.find((d) => d.slug === cfg.drive);
  if (!drive) throw new Error(`no drive with slug "${cfg.drive}"`);
  const tree = await getJson(`${cfg.base}/api/drives/${drive.id}/pages`, cfg.headers);
  const agent = findNode(tree, cfg.agent);
  const folder = (agent?.children ?? []).find((p) => p.title === SESSIONS_FOLDER && p.type === "FOLDER");
  const docs = (folder?.children ?? []).filter((p) => p.type === "DOCUMENT");
  return docs.map((p) => ({ pageId: p.id, id: sessionIdFromTitle(p.title), title: p.title }));
}
async function readPage(cfg, pageId) {
  const r = await fetch(`${cfg.base}/api/mcp/documents`, {
    method: "POST",
    headers: cfg.headers,
    body: JSON.stringify({ operation: "read", pageId }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} reading page`);
  return (await r.json())?.content ?? "";
}

async function sessionsCommand() {
  const cfg = apiCfg();
  try {
    const sessions = await remoteSessions(cfg);
    if (!sessions.length) {
      console.log("No synced sessions yet. Run a `pagespace` session and they appear under the agent.");
      return;
    }
    console.log(`Synced sessions (resume with: pagespace resume <id>):\n`);
    for (const s of sessions) console.log(`  ${s.title}`);
  } catch (err) {
    console.error(`pagespace: ${err.message}`);
    process.exit(1);
  }
}

async function resumeCommand(ref, rest) {
  if (!ref) {
    console.error("usage: pagespace resume <session-id>   (list ids with: pagespace sessions)");
    process.exit(1);
  }
  const cfg = apiCfg();
  try {
    const sessions = await remoteSessions(cfg);
    const { match, candidates } = resolveSessionRef(sessions, ref);
    if (!match) {
      if (candidates.length > 1) {
        console.error(`pagespace: "${ref}" is ambiguous (${candidates.length} sessions) — use a longer id:`);
        for (const s of candidates) console.error(`  ${s.id}`);
      } else {
        console.error(`pagespace: no synced session matching "${ref}". Try: pagespace sessions`);
      }
      process.exit(1);
    }
    const jsonl = extractJsonl(await readPage(cfg, match.pageId));
    const header = jsonl && parseHeader(jsonl);
    if (!jsonl || !header) {
      console.error("pagespace: that session page has no embedded session data to resume.");
      process.exit(1);
    }
    const cwd = header.cwd || process.cwd();
    const dir = process.env.PI_CODING_AGENT_SESSION_DIR
      ? process.env.PI_CODING_AGENT_SESSION_DIR
      : path.join(os.homedir(), ".pi", "agent", "sessions", encodeCwdDir(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${(header.timestamp || "").replace(/[:.]/g, "-")}_${header.id}.jsonl`;
    const dest = path.join(dir, fileName);
    fs.writeFileSync(dest, jsonl.endsWith("\n") ? jsonl : `${jsonl}\n`);
    process.stderr.write(`pagespace · resuming session ${header.id.slice(0, 8)} (${match.title})\n`);
    launchPi(["--session", header.id, ...rest]);
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
