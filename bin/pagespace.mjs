#!/usr/bin/env node
// Branded `pagespace` launcher: start pi with this package's extension preloaded and pass args
// through. Mirrors src/cli.ts buildPiLaunchArgs/resolveExtensionPath (kept in TS for unit tests).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extensions", "pagespace.ts");
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
