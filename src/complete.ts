/**
 * Completion gate with mandatory review (Epic 4).
 *
 * The spec-gated completion path is: deterministic shell gate → MANDATORY review → complete. The
 * shell gate (src/gate.ts) proves the code works; the review (src/review.ts) judges the change
 * against the leaf's `Given X, should Y` rubric. A leaf completes ONLY when both pass — and the
 * status flip is still owned by this gate-runner, never the implementer (no-self-complete). The
 * `task_complete` tool runs this; when given the leaf's `work` + `rubric`, the review is mandatory.
 *
 * The decision (`decideComplete`) is pure and unit-tested; the gate run, review call, and status
 * flip are integration/live-tested.
 */
import { Type } from "typebox";
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceConfig } from "./config.ts";
import { type GateResult, formatGateResults, runGates } from "./gate.ts";
import { type ReviewVerdict, review as runReview } from "./review.ts";

export interface CompleteResult {
  completed: boolean;
  gate: { pass: boolean; results: GateResult[] };
  review?: ReviewVerdict;
  /** Present when there was nothing to gate on. */
  reason?: string;
}

/** Pure: complete only when the shell gate passes AND (no review ran OR the review passed). */
export function decideComplete(gatePass: boolean, review: ReviewVerdict | undefined): boolean {
  return gatePass && (review ? review.pass : true);
}

/**
 * Run the shell gate, then (if `work`+`rubric` are given) the MANDATORY review, and flip the task to
 * completed ONLY when both pass. Backward-compatible: with no work/rubric it is shell-gate-only.
 */
export async function gatedCompleteWithReview(
  api: PageSpaceApi,
  config: PageSpaceConfig,
  args: {
    listPageId: string;
    taskId: string;
    gates: string[];
    cwd: string;
    work?: string;
    rubric?: string;
    status?: string;
    signal?: AbortSignal;
  },
): Promise<CompleteResult> {
  const hasReview = !!(args.work && args.rubric);
  if (args.gates.length === 0 && !hasReview) {
    return {
      completed: false,
      gate: { pass: false, results: [] },
      reason: "No gate or review defined for this leaf; cannot complete.",
    };
  }

  // Shell gate. With no shell commands but a review present, the review is the gate.
  const gate = args.gates.length
    ? await runGates(args.gates, args.cwd, { signal: args.signal })
    : { pass: true, results: [] as GateResult[] };

  let review: ReviewVerdict | undefined;
  if (gate.pass && hasReview) {
    review = await runReview(config, args.work as string, args.rubric as string, { signal: args.signal });
  }

  const completed = decideComplete(gate.pass, review);
  if (completed) await api.updateTaskStatus(args.listPageId, args.taskId, args.status ?? "completed");
  return { completed, gate, review };
}

/** Format a combined gate+review completion result for humans / logs. Pure. */
export function formatCompleteResult(r: CompleteResult): string {
  if (r.reason) return r.reason;
  const lines = [r.completed ? "COMPLETED (gate + review passed)" : "BLOCKED"];
  for (const g of r.gate.results) {
    lines.push(`  ${g.pass ? "✓" : "✗"} gate: ${g.command}${g.pass ? "" : ` (exit ${g.code})`}`);
  }
  if (r.review) {
    lines.push(`  ${r.review.pass ? "✓" : "✗"} review: ${r.review.summary || "(no summary)"}`);
    for (const i of r.review.issues) lines.push(`      [${i.severity}] ${i.note}`);
  }
  return lines.join("\n");
}

/** The format helper from gate.ts, re-exported for callers that only run shell gates. */
export { formatGateResults };

/**
 * Register the `task_complete` tool — the only path to completion. Runs the leaf's gate(s); when
 * `work`+`rubric` are supplied, also runs a mandatory review. Completes only if all pass.
 */
export function registerTaskCompleteTool(
  pi: { registerTool: (tool: any) => void },
  api: PageSpaceApi,
  config: PageSpaceConfig,
  cwd: string,
): void {
  pi.registerTool({
    name: "task_complete",
    label: "task_complete",
    description:
      "Request completion of a leaf task. Runs its gate command(s) and — when `work`+`rubric` are given — a mandatory review, and marks the PageSpace task completed ONLY if all pass. You cannot set task status any other way.",
    parameters: Type.Object({
      listPageId: Type.String({ description: "The TASK_LIST page id holding the task." }),
      taskId: Type.String({ description: "The task id (from listTasks / read_page)." }),
      gates: Type.Array(Type.String(), {
        description: "The gate command(s) from the leaf's spec (exit 0 = pass).",
      }),
      work: Type.Optional(
        Type.String({ description: "The change/summary to review (enables the mandatory review)." }),
      ),
      rubric: Type.Optional(
        Type.String({ description: "The leaf's acceptance criteria to review against." }),
      ),
    }),
    async execute(
      _id: string,
      params: { listPageId: string; taskId: string; gates: string[]; work?: string; rubric?: string },
      signal?: AbortSignal,
    ) {
      const result = await gatedCompleteWithReview(api, config, { ...params, cwd, signal });
      return { content: [{ type: "text", text: formatCompleteResult(result) }], details: { result } };
    },
  });
}
