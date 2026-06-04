/**
 * Gated completion (Epic 4) — "done" is enforced, not claimed.
 *
 * A leaf completes only when its deterministic GATE passes. The agent never writes task status
 * directly; it requests completion via `task_complete`, which runs the gate command(s) and flips the
 * PageSpace task to "completed" ONLY when every gate exits 0. On failure the task stays open and the
 * failure is returned to iterate. Completion is thus owned by the gate-runner, not the implementer
 * (no-self-complete). The roll-up guard (a container can't complete while children are open) is
 * enforced server-side by PageSpace.
 *
 * The aggregation (`allPass`) is pure and unit-tested; running a command and flipping status are
 * integration/live-tested.
 */
import { execFile } from "node:child_process";
import type { PageSpaceApi } from "./api.ts";

export interface GateResult {
  command: string;
  pass: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/** Pure: a gate set passes only when every command passed. */
export function allPass(results: GateResult[]): boolean {
  return results.length > 0 && results.every((r) => r.pass);
}

/** Run one gate command in a shell; exit 0 = pass. Never throws — failures are encoded in the result. */
export function runGate(
  command: string,
  cwd: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<GateResult> {
  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", command],
      { cwd, signal: opts.signal, timeout: opts.timeoutMs ?? 600_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        resolve({ command, pass: code === 0, code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** Run every gate command (stops early on the first failure). */
export async function runGates(
  commands: string[],
  cwd: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ pass: boolean; results: GateResult[] }> {
  const results: GateResult[] = [];
  for (const command of commands) {
    const r = await runGate(command, cwd, opts);
    results.push(r);
    if (!r.pass) break; // a failed gate fails the set; no point running the rest
  }
  return { pass: allPass(results), results };
}

export interface GatedCompleteResult {
  completed: boolean;
  pass: boolean;
  results: GateResult[];
  /** Present when there were no gates to run (cannot gate-complete). */
  reason?: string;
}

/**
 * Run the gates and flip the task to "completed" ONLY on pass. With no gates, refuses to complete
 * (a leaf without a gate cannot be gate-completed — that is the point of the gate).
 */
export async function gatedComplete(
  api: PageSpaceApi,
  args: {
    listPageId: string;
    taskId: string;
    gates: string[];
    cwd: string;
    status?: string;
    signal?: AbortSignal;
  },
): Promise<GatedCompleteResult> {
  if (args.gates.length === 0) {
    return {
      completed: false,
      pass: false,
      results: [],
      reason: "No gate defined for this leaf; cannot gate-complete.",
    };
  }
  const { pass, results } = await runGates(args.gates, args.cwd, { signal: args.signal });
  if (!pass) return { completed: false, pass, results };
  await api.updateTaskStatus(args.listPageId, args.taskId, args.status ?? "completed");
  return { completed: true, pass, results };
}

/** Format a gated-completion result for humans / logs. Pure. */
export function formatGateResults(r: GatedCompleteResult): string {
  if (r.reason) return r.reason;
  const head = r.completed ? "COMPLETED (gate passed)" : "BLOCKED (gate failed)";
  const lines = [head];
  for (const g of r.results) {
    lines.push(`  ${g.pass ? "✓" : "✗"} ${g.command}${g.pass ? "" : ` (exit ${g.code})`}`);
    if (!g.pass) {
      const tail = (g.stderr || g.stdout).trim().split("\n").slice(-6).join("\n");
      if (tail) lines.push(tail.replace(/^/gm, "    "));
    }
  }
  return lines.join("\n");
}
