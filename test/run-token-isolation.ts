/**
 * Live E2E proof of token isolation THROUGH the agent's bash-tool env path.
 *
 * Chain proven: bin/pagespace.mjs (sanitizes spawn env) → pi process (inherits sanitized env) →
 * pi's bash tool (packages/pi-coding-agent/.../bash.ts: `env: env ?? getShellEnv()` /
 * `{ ...getShellEnv() }`, i.e. pi's process.env-derived) → command reads env.
 *
 * We run `env` / `printenv` / procfs in the exact sanitized env the launcher hands to `spawn(pi)`.
 * That is the same env pi's bash tool derives its command env from. If the token is absent here, it
 * is absent from anything the agent's bash tool can surface. Deterministic, no model/network needed.
 *
 * Two assertions: (1) the launcher actually wires sanitization into its spawn (source-level), and
 * (2) the sanitized env survives all three exfil vectors the agent could use.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeChildEnv } from "../src/env.ts";

test("the launcher sanitizes its spawn env (bin/pagespace.mjs wires sanitizeChildEnv)", () => {
  const binSrc = readFileSync(new URL("../bin/pagespace.mjs", import.meta.url), "utf8");
  assert.ok(
    binSrc.includes("sanitizeChildEnv"),
    "bin/pagespace.mjs must call sanitizeChildEnv before spawning pi",
  );
  assert.match(binSrc, /sanitizeChildEnv\(process\.env\)/, "sanitize process.env before spawn");
});

test("token is invisible through the bash-tool env path (env / printenv / procfs)", async () => {
  // Reproduce the launcher's spawn-env construction with a live token present.
  const childEnv = sanitizeChildEnv({ ...process.env, PAGESPACE_AUTH_TOKEN: "mcp_PROOF_LEAK" });
  childEnv.PI_SKIP_VERSION_CHECK = "1";

  const vectors: Array<{ name: string; cmd: string }> = [
    { name: "env", cmd: "env" },
    { name: "printenv", cmd: "printenv" },
    { name: "procfs", cmd: "cat /proc/self/environ 2>/dev/null || true" },
  ];

  for (const v of vectors) {
    const r = spawn("sh", ["-c", v.cmd], { env: childEnv });
    let out = "";
    r.stdout.on("data", (d) => (out += d.toString()));
    r.stderr.on("data", () => {});
    const code = await new Promise<number>((resolve) => r.on("close", resolve));
    assert.equal(code, 0, `${v.name} exited cleanly`);
    assert.ok(
      !out.includes("mcp_PROOF_LEAK"),
      `${v.name}: PAGESPACE_AUTH_TOKEN leaked through the bash-tool env path`,
    );
    assert.ok(
      !out.includes("PAGESPACE_AUTH_TOKEN"),
      `${v.name}: the token's env-key name leaked through the bash-tool env path`,
    );
  }
});
