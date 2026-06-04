#!/usr/bin/env node
// Branded `pagespace` launcher. `pagespace status` runs a config/auth doctor; anything else starts
// pi with this package's extension preloaded and passes args through. Mirrors src/cli.ts
// (buildPiLaunchArgs/resolveExtensionPath/checkConfig — kept in TS for unit tests).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

if (process.argv[2] === "status" || process.argv.includes("--check")) {
  statusDoctor();
} else {
  // Banner to stderr so it never pollutes stdout / --mode json. Suppressed in non-interactive (-p)
  // and json/rpc modes to keep machine output clean.
  const passthrough = process.argv.slice(2);
  const quiet = passthrough.includes("-p") || passthrough.includes("--print") || passthrough.includes("--mode");
  if (!quiet) process.stderr.write("pagespace · PageSpace-native pi (dual-mount + PageSpace brain)\n");
  const userManagesSkills =
    passthrough.includes("--no-skills") || passthrough.includes("-ns") || passthrough.includes("--skill");
  const skillFlags = userManagesSkills ? [] : ["--no-skills", ...vendoredSkillFlags()];
  const args = ["-e", extensionPath, ...skillFlags, ...passthrough];
  const child = spawn("pi", args, { stdio: "inherit" });
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
