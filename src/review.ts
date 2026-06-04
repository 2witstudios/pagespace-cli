/**
 * Review-as-gate (Epic 3) — a mandatory, deterministically-invoked completion gate.
 *
 * AIDD's `/review` is judgment, but here it is a GATE the harness runs every time (the Epic-4 build
 * loop calls it before completing a leaf), not an optional skill. Given the WORK done and a RUBRIC
 * (the leaf's `Given X, should Y` acceptance criteria), the PageSpace brain returns structured
 * issues; the pass/fail decision is then computed in CODE (fail-safe): a `blocker` issue — or no
 * parseable verdict — fails the gate. The model reasons; the harness decides.
 *
 * Pure helpers (prompt building, verdict parsing, the gate decision, formatting) are unit-tested;
 * the model call is live.
 */
import { Type } from "typebox";
import type { PageSpaceConfig } from "./config.ts";
import { type BrainMessage, completeViaBrain } from "./brain.ts";
import { tryExtractFirstJsonObject } from "./tool-call-parser.ts";

export type Severity = "blocker" | "major" | "minor";

export interface ReviewIssue {
  severity: Severity;
  note: string;
}

export interface ReviewVerdict {
  /** Computed in code (fail-safe), not taken from the model. */
  pass: boolean;
  issues: ReviewIssue[];
  summary: string;
}

/** The gate decision: a blocker fails the gate; everything else passes. Pure. */
export function computePass(issues: ReviewIssue[]): boolean {
  return !issues.some((i) => i.severity === "blocker");
}

function normalizeSeverity(raw: unknown): Severity {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("block") || s.includes("critical") || s.includes("fail")) return "blocker";
  if (s.includes("major") || s.includes("high")) return "major";
  return "minor";
}

/**
 * Parse the model's JSON verdict into issues + a code-computed pass. Fail-safe: if no verdict can be
 * extracted, the gate FAILS (a review that didn't produce a verdict must not silently pass).
 */
export function parseVerdict(text: string): ReviewVerdict {
  const found = tryExtractFirstJsonObject(text);
  if (!found || typeof found.value !== "object" || found.value === null) {
    return {
      pass: false,
      issues: [{ severity: "blocker", note: "Review produced no parseable verdict." }],
      summary: "",
    };
  }
  const obj = found.value as { issues?: unknown; summary?: unknown };
  const issues: ReviewIssue[] = [];
  if (Array.isArray(obj.issues)) {
    for (const raw of obj.issues) {
      const it = raw as { severity?: unknown; note?: unknown; issue?: unknown };
      const note =
        typeof it?.note === "string" ? it.note.trim() : typeof it?.issue === "string" ? it.issue.trim() : "";
      if (note) issues.push({ severity: normalizeSeverity(it?.severity), note });
    }
  }
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  return { pass: computePass(issues), issues, summary };
}

/** Render a verdict for humans / logs. Pure. */
export function formatVerdict(v: ReviewVerdict): string {
  const lines = [`${v.pass ? "PASS" : "FAIL"}: ${v.summary || "(no summary)"}`];
  for (const i of v.issues) lines.push(`  [${i.severity}] ${i.note}`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a strict code reviewer acting as a COMPLETION GATE. Given the WORK done and the RUBRIC (acceptance criteria), judge whether the work satisfies every rubric criterion.

Output ONLY a JSON object — no prose, no markdown, no code fences:
{"summary": "<one-line verdict>", "issues": [{"severity": "blocker|major|minor", "note": "<what is wrong or which criterion is unmet>"}]}

Rules:
- "blocker": a rubric criterion is unmet, or the change is incorrect/broken. Any blocker fails the gate.
- "major"/"minor": quality concerns that do not block completion.
- If the work fully satisfies the rubric, return "issues": [].
- Be specific; reference the unmet criterion.`;

/** Build the brain messages for a review. Pure. */
export function buildReviewMessages(work: string, rubric: string): BrainMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `RUBRIC (acceptance criteria):\n${rubric}\n\nWORK (changes / summary to review):\n${work}`,
    },
  ];
}

/** Run the review gate via the PageSpace brain. */
export async function review(
  config: PageSpaceConfig,
  work: string,
  rubric: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ReviewVerdict> {
  const text = await completeViaBrain(config, buildReviewMessages(work, rubric), opts);
  return parseVerdict(text);
}

/** Register the `review` tool (the mandatory completion gate, invokable as a step). */
export function registerReviewTool(pi: { registerTool: (tool: any) => void }, config: PageSpaceConfig): void {
  pi.registerTool({
    name: "review",
    label: "review",
    description:
      "Review WORK against a RUBRIC (Given X, should Y criteria) via the PageSpace brain and return a pass/fail gate verdict. A blocking issue fails the gate.",
    parameters: Type.Object({
      work: Type.String({ description: "The changes / summary to review." }),
      rubric: Type.String({ description: "The acceptance criteria to judge against." }),
    }),
    async execute(_id: string, params: { work: string; rubric: string }, signal?: AbortSignal) {
      const verdict = await review(config, params.work, params.rubric, { signal });
      return { content: [{ type: "text", text: formatVerdict(verdict) }], details: { verdict } };
    },
  });
}
