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
import { type Spec, parseSpec, unmetDeps } from "./spec.ts";
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

/** Read a leaf's spec from its backing page (Given/should criteria + gate commands + deps). */
export async function loadLeafSpec(api: PageSpaceApi, task: TaskRecord): Promise<Spec> {
  if (!task.pageId) return { criteria: [], gates: [], dependsOn: [] };
  return parseSpec(await api.readContent(task.pageId));
}

export interface BuildResult {
  /** True when there is no remaining active leaf in the list. */
  done: boolean;
  leaf?: TaskRecord;
  spec?: Spec;
  /** Present when work/implement ran and the leaf was gate+review checked. */
  result?: CompleteResult;
  /** Set when every remaining leaf is blocked by unmet dependencies. */
  blocked?: { leaf: TaskRecord; unmet: string[] }[];
}

/**
 * Advance one leaf: pick the next workable leaf (not done, and whose `depends-on` are all done),
 * load its spec, and — when `work` (or `implement`) is provided — run the gate + mandatory review
 * and complete it. The review rubric is the leaf's own acceptance criteria. Leaves whose deps are
 * unmet are skipped; if every remaining leaf is dep-blocked, `blocked` lists them.
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
  const tasks = await api.listTasks(opts.listPageId);
  const done = new Set<string>();
  for (const t of tasks) {
    if (isLeafDone(t)) {
      done.add(t.title);
      done.add(t.id);
    }
  }
  const active = tasks.filter((t) => !isLeafDone(t));
  if (active.length === 0) return { done: true };

  // Find the first active leaf whose dependencies are all satisfied.
  const blocked: { leaf: TaskRecord; unmet: string[] }[] = [];
  let leaf: TaskRecord | undefined;
  let spec: Spec | undefined;
  for (const candidate of active) {
    const s = await loadLeafSpec(api, candidate);
    const unmet = unmetDeps(s.dependsOn, done);
    if (unmet.length === 0) {
      leaf = candidate;
      spec = s;
      break;
    }
    blocked.push({ leaf: candidate, unmet });
  }
  if (!leaf || !spec) return { done: false, blocked };

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
  if (b.blocked && !b.leaf) {
    return [
      "All remaining leaves are blocked by unmet dependencies:",
      ...b.blocked.map((x) => `  ${x.leaf.title} ⟂ needs: ${x.unmet.join(", ")}`),
    ].join("\n");
  }
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
