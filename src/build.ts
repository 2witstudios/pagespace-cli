/**
 * /build loop (Epic 4) — the spec-gated build driver.
 *
 * Composes everything: pick the next unblocked leaf → load its spec (Given X/should Y + gate:) →
 * [implement] → gate + mandatory review → complete (PageSpace rolls the epic up when the last leaf
 * passes) or stay blocked. The implementer never flips status; only the gated completion does.
 *
 * Two modes:
 *  - autonomous: pass `work` (or an `implement` callback, e.g. a subagent run) → the loop gates and
 *    completes the leaf.
 *  - human-in-loop: pass neither → the loop just surfaces {leaf, spec} so a human/agent can act,
 *    then call `task_complete` (or buildNext with work) when ready.
 *
 * `pickNextLeaf` is pure (unit-tested); loading specs, running the gate/review, and flipping status
 * are live-tested.
 */
import type { PageSpaceApi, TaskRecord } from "./api.ts";
import type { PageSpaceConfig } from "./config.ts";
import { Type } from "typebox";
import { type Spec, parseSpec } from "./spec.ts";
import { formatRequirements } from "./requirements.ts";
import { type CompleteResult, formatCompleteResult, gatedCompleteWithReview } from "./complete.ts";

/** A task is "done" when its status group is done (or its status is completed). Pure. */
export function isLeafDone(task: TaskRecord): boolean {
  return task.statusGroup === "done" || task.status === "completed" || task.status === "done";
}

/** The next workable leaf: the first task that is not done, preserving order. Pure. Null when all done. */
export function pickNextLeaf(tasks: TaskRecord[]): TaskRecord | null {
  return tasks.find((t) => !isLeafDone(t)) ?? null;
}

/** Read a leaf's spec from its backing page (Given/should criteria + gate commands). */
export async function loadLeafSpec(api: PageSpaceApi, task: TaskRecord): Promise<Spec> {
  if (!task.pageId) return { criteria: [], gates: [] };
  return parseSpec(await api.readContent(task.pageId));
}

export interface BuildResult {
  /** True when there is no remaining active leaf in the list. */
  done: boolean;
  leaf?: TaskRecord;
  spec?: Spec;
  /** Present when work/implement ran and the leaf was gate+review checked. */
  result?: CompleteResult;
}

/**
 * Advance one leaf: pick the next unblocked leaf, load its spec, and — when `work` (or `implement`)
 * is provided — run the gate + mandatory review and complete it. The review rubric is the leaf's own
 * acceptance criteria.
 */
export async function buildNext(
  api: PageSpaceApi,
  config: PageSpaceConfig,
  opts: {
    listPageId: string;
    cwd: string;
    work?: string;
    implement?: (leaf: TaskRecord, spec: Spec) => Promise<string>;
    signal?: AbortSignal;
  },
): Promise<BuildResult> {
  const leaf = pickNextLeaf(await api.listTasks(opts.listPageId));
  if (!leaf) return { done: true };

  const spec = await loadLeafSpec(api, leaf);
  let work = opts.work;
  if (!work && opts.implement) work = await opts.implement(leaf, spec);
  if (!work) return { done: false, leaf, spec };

  const rubric = formatRequirements(spec.criteria);
  const result = await gatedCompleteWithReview(api, config, {
    listPageId: opts.listPageId,
    taskId: leaf.id,
    gates: spec.gates,
    cwd: opts.cwd,
    work,
    rubric: rubric || undefined,
    signal: opts.signal,
  });
  return { done: false, leaf, spec, result };
}

/** Render a build step for humans / logs. Pure. */
export function formatBuildResult(b: BuildResult): string {
  if (b.done) return "No active leaf remaining — the list is complete.";
  const head = `Next leaf: ${b.leaf?.title ?? "(untitled)"}`;
  const specLine = `  ${b.spec?.criteria.length ?? 0} criteria, gates: ${JSON.stringify(b.spec?.gates ?? [])}`;
  if (!b.result) return [head, specLine, "  (no work supplied — implement, then complete)"].join("\n");
  return [head, specLine, formatCompleteResult(b.result).replace(/^/gm, "  ")].join("\n");
}

/** Register the `build` tool — advance the spec-gated build by one leaf. */
export function registerBuildTool(
  pi: { registerTool: (tool: any) => void },
  api: PageSpaceApi,
  config: PageSpaceConfig,
  cwd: string,
): void {
  pi.registerTool({
    name: "build",
    label: "build",
    description:
      "Spec-gated build: pick the next unblocked leaf on a TASK_LIST and load its spec. Supply `work` to gate + review + complete it; omit `work` to just surface the leaf and its spec.",
    parameters: Type.Object({
      listPageId: Type.String({ description: "The epic TASK_LIST page id." }),
      work: Type.Optional(
        Type.String({ description: "The change/summary to gate + review for completion." }),
      ),
    }),
    async execute(_id: string, params: { listPageId: string; work?: string }, signal?: AbortSignal) {
      const result = await buildNext(api, config, { ...params, cwd, signal });
      return { content: [{ type: "text", text: formatBuildResult(result) }], details: { result } };
    },
  });
}
