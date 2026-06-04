/**
 * Fix step (Epic 3) — the reasoning half of the AIDD TDD fix loop.
 *
 * Given a FAILURE (failing test output / error) and the relevant CODE/CONTEXT, the PageSpace brain
 * diagnoses the root cause and proposes a concrete, minimal fix. This is the judgment step; the
 * apply-and-gate loop (run tests, commit only when green) is the spec-gated /build engine (Epic 4),
 * which composes this with the existing test gate (`npm test` in the husky pre-commit) and the
 * gated PR flow. The model reasons; the harness drives when it runs and what gates the result.
 *
 * Pure helpers (prompt building, parsing, formatting) are unit-tested; the model call is live.
 */
import { Type } from "typebox";
import type { PageSpaceConfig } from "./config.ts";
import { type BrainMessage, completeViaBrain } from "./brain.ts";
import { tryExtractFirstJsonObject } from "./tool-call-parser.ts";

export interface FixProposal {
  diagnosis: string;
  fix: { file?: string; change: string };
  /** Optional: a regression test that would catch this bug. */
  newTests?: string;
}

/** Parse the model's JSON fix proposal. Returns null when nothing usable was produced. Pure. */
export function parseFix(text: string): FixProposal | null {
  const found = tryExtractFirstJsonObject(text);
  if (!found || typeof found.value !== "object" || found.value === null) return null;
  const o = found.value as {
    diagnosis?: unknown;
    fix?: unknown;
    change?: unknown;
    newTests?: unknown;
    tests?: unknown;
  };
  const diagnosis = typeof o.diagnosis === "string" ? o.diagnosis.trim() : "";
  const fixObj = (o.fix && typeof o.fix === "object" ? o.fix : {}) as { file?: unknown; change?: unknown };
  const change =
    typeof fixObj.change === "string"
      ? fixObj.change.trim()
      : typeof o.change === "string"
        ? o.change.trim()
        : "";
  if (!diagnosis && !change) return null;
  const file = typeof fixObj.file === "string" && fixObj.file.trim() ? fixObj.file.trim() : undefined;
  const newTests =
    typeof o.newTests === "string" && o.newTests.trim()
      ? o.newTests.trim()
      : typeof o.tests === "string" && o.tests.trim()
        ? o.tests.trim()
        : undefined;
  return { diagnosis, fix: { file, change }, newTests };
}

/** Render a fix proposal for humans / logs. Pure. */
export function formatFix(f: FixProposal): string {
  const lines = [`Diagnosis: ${f.diagnosis || "(none)"}`];
  if (f.fix.file) lines.push(`File: ${f.fix.file}`);
  lines.push(`Fix: ${f.fix.change || "(none)"}`);
  if (f.newTests) lines.push(`Test to add: ${f.newTests}`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a debugging assistant in a TDD fix loop. Given a FAILURE (failing test output or error) and the CODE/CONTEXT, diagnose the root cause and propose a concrete, minimal fix that makes the failing test pass without breaking others.

Output ONLY a JSON object — no prose, no markdown, no code fences:
{"diagnosis": "<root cause>", "fix": {"file": "<path if known>", "change": "<the concrete change to make>"}, "newTests": "<optional: a regression test that would catch this>"}

Rules:
- Minimal change; reference the actual bug.
- "change" must say what to change to what (concrete), not a vague suggestion.`;

/** Build the brain messages for a fix proposal. Pure. */
export function buildFixMessages(failure: string, context: string): BrainMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `FAILURE:\n${failure}\n\nCODE / CONTEXT:\n${context}` },
  ];
}

/** Propose a fix for a failure via the PageSpace brain. */
export async function proposeFix(
  config: PageSpaceConfig,
  failure: string,
  context: string,
  opts: { signal?: AbortSignal } = {},
): Promise<FixProposal | null> {
  const text = await completeViaBrain(config, buildFixMessages(failure, context), opts);
  return parseFix(text);
}

/** Register the `fix` tool (the fix reasoning step). */
export function registerFixTool(pi: { registerTool: (tool: any) => void }, config: PageSpaceConfig): void {
  pi.registerTool({
    name: "fix",
    label: "fix",
    description:
      "Diagnose a FAILURE (failing test / error) given the CODE/CONTEXT and propose a concrete minimal fix via the PageSpace brain.",
    parameters: Type.Object({
      failure: Type.String({ description: "The failing test output or error message." }),
      context: Type.String({ description: "The relevant code / context to fix." }),
    }),
    async execute(_id: string, params: { failure: string; context: string }, signal?: AbortSignal) {
      const proposal = await proposeFix(config, params.failure, params.context, { signal });
      const text = proposal ? formatFix(proposal) : "(no fix proposal produced)";
      return { content: [{ type: "text", text }], details: { proposal } };
    },
  });
}
