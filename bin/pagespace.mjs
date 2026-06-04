#!/usr/bin/env node
// Branded `pagespace` launcher. `pagespace status` runs a config/auth doctor; anything else starts
// pi with this package's extension preloaded and passes args through. Mirrors src/cli.ts
// (buildPiLaunchArgs/resolveExtensionPath/checkConfig — kept in TS for unit tests).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extensions", "pagespace.ts");

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

if (process.argv[2] === "status" || process.argv.includes("--check")) {
  statusDoctor();
} else {
  const args = ["-e", extensionPath, ...process.argv.slice(2)];
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
