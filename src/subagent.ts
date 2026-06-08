/**
 * Fan-out / sub-agent primitive (Epic 3) — adapted from pi's `examples/extensions/subagent`.
 *
 * AIDD's agent-orchestration (fan-out / parallel / delegate) is mechanism, so it belongs in the
 * harness as a deterministic primitive rather than a model-discretion skill. This spawns child pagespace
 * processes (`pagespace --mode json -p --no-session`) for sub-tasks — single or parallel — and parses
 * their NDJSON output. Children inherit the environment, so a PageSpace-native parent yields
 * PageSpace-native children (same brain + dual-mount). The cloud form (Epic 6) swaps the local
 * spawn for PageSpace-launched containers behind the same interface.
 *
 * Pure helpers (arg building, NDJSON parsing) are unit-tested; the spawn path is tested against a
 * stub child (no model needed), so it runs in CI.
 */
import { spawn } from "node:child_process";
import { Type } from "typebox";
import { textFromContent } from "./persistence.ts";

/** Sub-agents cannot themselves spawn sub-agents (depth guard against runaway fan-out). */
export const MAX_SUBAGENT_DEPTH = 1;
/** Cap on parallel children per fan-out call. */
export const MAX_PARALLEL = 8;
const DEPTH_ENV = "PAGESPACE_SUBAGENT_DEPTH";

/** Current sub-agent nesting depth from the environment (0 at the top level). */
export function currentDepth(env: NodeJS.ProcessEnv = process.env): number {
  return Number.parseInt(env[DEPTH_ENV] ?? "0", 10) || 0;
}

/** Environment for a child, with the nesting depth incremented. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, [DEPTH_ENV]: String(currentDepth(env) + 1) };
}

export interface SubagentResult {
  /** The child's final assistant text. */
  text: string;
  /** Number of assistant turns. */
  turns: number;
  /** Number of tool calls the child made. */
  toolCalls: number;
  stopReason?: string;
  errorMessage?: string;
}

export interface PagespaceSubagentOptions {
  /** Model pattern for the child (e.g. "pagespace/<brainPageId>"). */
  model?: string;
  /** Allowlist of tool names for the child (pi `--tools`). */
  tools?: string[];
  /** Path to a file whose contents are appended to the child's system prompt. */
  appendSystemPromptPath?: string;
}

/** Build the argv for a pagespace child run (`--mode json`). Pure. */
export function buildPiArgs(task: string, opts: PagespaceSubagentOptions = {}): string[] {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.tools && opts.tools.length > 0) args.push("--tools", opts.tools.join(","));
  if (opts.appendSystemPromptPath) args.push("--append-system-prompt", opts.appendSystemPromptPath);
  args.push(`Task: ${task}`);
  return args;
}

/** Parse pagespace's `--mode json` NDJSON stream into a single result. Pure. Last assistant text wins. */
export function parseJsonModeOutput(stdout: string): SubagentResult {
  const result: SubagentResult = { text: "", turns: 0, toolCalls: 0 };
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let ev: any;
    try {
      ev = JSON.parse(t);
    } catch {
      continue; // non-JSON line
    }
    if (ev.type === "message_end" && ev.message && ev.message.role === "assistant") {
      const m = ev.message;
      result.turns++;
      const text = textFromContent(m.content).trim();
      if (text) result.text = text;
      if (Array.isArray(m.content)) {
        result.toolCalls += m.content.filter((c: { type?: unknown }) => c?.type === "toolCall").length;
      }
      if (m.stopReason) result.stopReason = m.stopReason;
      if (m.errorMessage) result.errorMessage = m.errorMessage;
    }
  }
  return result;
}

export interface SpawnOptions {
  cwd?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/** Spawn a command, collect stdout/stderr, and parse it as pagespace output. */
export async function runViaCommand(
  command: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<SubagentResult> {
  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve) => {
      const proc = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        signal: opts.signal,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d) => (stdout += d.toString()));
      proc.stderr?.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (e) => resolve({ stdout, stderr: stderr + String(e), code: 1 }));
      proc.on("close", (c) => resolve({ stdout, stderr, code: c ?? 0 }));
    },
  );
  const result = parseJsonModeOutput(stdout);
  if (code !== 0 && !result.errorMessage) {
    result.errorMessage = stderr.trim() || `child exited with code ${code}`;
  }
  return result;
}

/** Run a single sub-task as a pagespace child. `opts.command` (default "pagespace") allows a stub in tests. */
export async function runPagespaceSubagent(
  task: string,
  opts: PagespaceSubagentOptions & { command?: string } & SpawnOptions = {},
): Promise<SubagentResult> {
  return runViaCommand(opts.command ?? "pagespace", buildPiArgs(task, opts), opts);
}

export interface FanoutTask {
  task: string;
  model?: string;
  tools?: string[];
}

/** Run sub-tasks in parallel as pagespace children (the fan-out primitive). */
export async function runPagespaceFanout(
  tasks: FanoutTask[],
  opts: { command?: string; model?: string; tools?: string[] } & SpawnOptions = {},
): Promise<SubagentResult[]> {
  return Promise.all(
    tasks.map((t) =>
      runPagespaceSubagent(t.task, {
        ...opts,
        model: t.model ?? opts.model,
        tools: t.tools ?? opts.tools,
      }),
    ),
  );
}

/**
 * Register the `subagent` tool: spawn one child (`task`) or fan out in parallel (`tasks`). Children
 * inherit a PageSpace-native environment with the nesting depth incremented. Caller should only
 * register this when `currentDepth() < MAX_SUBAGENT_DEPTH` so sub-agents can't recurse.
 */
export function registerSubagentTool(
  pi: { registerTool: (tool: any) => void },
  opts: { model?: string } = {},
): void {
  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: `Delegate to pagespace sub-agent(s) in child processes. Provide \`task\` for one, or \`tasks\` (array of {task}) to fan out in parallel (max ${MAX_PARALLEL}). Each child is a fresh pagespace process; returns their final answers. Use for independent, parallelizable work.`,
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "A single sub-task prompt." })),
      tasks: Type.Optional(
        Type.Array(Type.Object({ task: Type.String() }), {
          description: "Sub-tasks to run in parallel, each as its own child.",
        }),
      ),
    }),
    async execute(_id: string, params: { task?: string; tasks?: { task: string }[] }, signal?: AbortSignal) {
      const env = childEnv();
      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > MAX_PARALLEL) {
          return {
            content: [
              {
                type: "text",
                text: `Too many parallel tasks (${params.tasks.length}); max is ${MAX_PARALLEL}.`,
              },
            ],
            details: {},
          };
        }
        const results = await runPagespaceFanout(params.tasks, { model: opts.model, env, signal });
        const text = results
          .map((r, i) => `### sub-agent ${i + 1}\n${r.errorMessage ? `ERROR: ${r.errorMessage}` : r.text}`)
          .join("\n\n");
        return { content: [{ type: "text", text }], details: { results } };
      }
      if (params.task) {
        const r = await runPagespaceSubagent(params.task, { model: opts.model, env, signal });
        return {
          content: [{ type: "text", text: r.errorMessage ? `ERROR: ${r.errorMessage}` : r.text }],
          details: { result: r },
        };
      }
      return { content: [{ type: "text", text: "Provide `task` or `tasks`." }], details: {} };
    },
  });
}
