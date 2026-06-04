/**
 * Churn analysis (Epic 3) — AIDD `churn` as a harness primitive.
 *
 * "Churn" surfaces change-frequency hotspots: the files changed in the most commits, which tend to
 * be the riskiest and most worth reviewing/refactoring. This parses `git log --name-only` output
 * into per-file commit counts. (The other two parts of this leaf — *commit* discipline and *log* —
 * are already harness features: the husky pre-commit `npm run check` + the gated PR flow, and the
 * `agent_end` auto-persist hook that logs to the Activity Log.)
 *
 * The parser is pure (unit-tested); running git is integration-tested locally (CI checks out shallow
 * history, so the git run is not a CI test).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

export interface ChurnEntry {
  file: string;
  commits: number;
}

const FULL_HASH = /^[0-9a-f]{40}$/;

/**
 * Parse `git log --name-only --pretty=format:%H` output into per-file commit counts, sorted by
 * frequency (desc), then path. Pure. Hash lines (the per-commit %H) and blanks are separators; every
 * other non-empty line is a changed file (listed once per commit by --name-only).
 */
export function parseChurn(gitLogOutput: string): ChurnEntry[] {
  const counts = new Map<string, number>();
  for (const raw of gitLogOutput.split("\n")) {
    const line = raw.trim();
    if (!line || FULL_HASH.test(line)) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, commits]) => ({ file, commits }))
    .sort((a, b) => b.commits - a.commits || a.file.localeCompare(b.file));
}

/** Render churn entries as a `<count>  <file>` table. Pure. */
export function formatChurn(entries: ChurnEntry[], limit = 20): string {
  if (entries.length === 0) return "(no churn data)";
  return entries
    .slice(0, limit)
    .map((e) => `${String(e.commits).padStart(4)}  ${e.file}`)
    .join("\n");
}

/** Compute git churn for a repo by running git (no shell). */
export async function computeChurn(
  cwd: string,
  opts: { since?: string; max?: number } = {},
): Promise<ChurnEntry[]> {
  const args = ["log", "--name-only", "--pretty=format:%H"];
  if (opts.since) args.push(`--since=${opts.since}`);
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  const entries = parseChurn(stdout);
  return opts.max ? entries.slice(0, opts.max) : entries;
}

/** Register the `churn` tool (file change-frequency hotspots). */
export function registerChurnTool(pi: { registerTool: (tool: any) => void }, cwd: string): void {
  pi.registerTool({
    name: "churn",
    label: "churn",
    description:
      "Show git churn — the files changed in the most commits (change-frequency hotspots, useful for risk/refactor targeting).",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max files to show (default 20)." })),
      since: Type.Optional(Type.String({ description: "Only commits since this date/ref (git --since)." })),
    }),
    async execute(_id: string, params: { limit?: number; since?: string }) {
      const entries = await computeChurn(cwd, { since: params.since });
      return {
        content: [{ type: "text", text: formatChurn(entries, params.limit ?? 20) }],
        details: { entries },
      };
    },
  });
}
