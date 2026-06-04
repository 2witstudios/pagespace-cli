/**
 * Requirements step (Epic 3) — a deterministically-invoked LLM step.
 *
 * AIDD's `/requirements` is judgment, so the harness owns *when* it runs and validates its output,
 * while the model still reasons. This turns a development request into schema-validated
 * `Given X, should Y` acceptance criteria via the PageSpace brain, then parses/validates the result
 * (lenient extraction, since the model may wrap the JSON in prose). The Epic-4 spec-gated build loop
 * invokes this deterministically; here it's also exposed as a `requirements` tool.
 *
 * Pure helpers (extraction, validation, formatting) are unit-tested; the model call is live.
 */
import { Type } from "typebox";
import type { PageSpaceConfig } from "./config.ts";
import { type BrainMessage, completeViaBrain } from "./brain.ts";

export interface Requirement {
  given: string;
  should: string;
}

/** Extract the first complete, balanced JSON array from text (string/escape aware). Pure. */
export function extractJsonArray(s: string): unknown[] | null {
  const start = s.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(s.slice(start, i + 1));
          return Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Validate the model output into clean `Given/should` requirements. Pure. */
export function parseRequirements(text: string): Requirement[] {
  const arr = extractJsonArray(text);
  if (!arr) return [];
  const out: Requirement[] = [];
  for (const item of arr) {
    const obj = item as { given?: unknown; should?: unknown };
    const given = typeof obj?.given === "string" ? obj.given.trim() : "";
    const should = typeof obj?.should === "string" ? obj.should.trim() : "";
    if (given && should) out.push({ given, should });
  }
  return out;
}

/** Render requirements as AIDD `Given X, should Y` bullets. Pure; "" when empty. */
export function formatRequirements(reqs: Requirement[]): string {
  if (reqs.length === 0) return "";
  return reqs.map((r) => `- Given ${r.given}, should ${r.should}`).join("\n");
}

const SYSTEM_PROMPT = `You are a requirements analyst. Given a development request, produce a focused set of acceptance criteria in the AIDD "Given X, should Y" form.

Output ONLY a JSON array — no prose, no markdown, no code fences:
[{"given": "<situation/context>", "should": "<observable expected behavior>"}]

Rules:
- Each item is a single, testable, novel requirement. Omit obvious boilerplate.
- "given" is the situation/context; "should" is the job-to-do / observable outcome.
- Typically 3-8 items. Be concise and concrete.`;

/** Build the brain messages for a requirements generation. Pure. */
export function buildRequirementsMessages(request: string): BrainMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Request:\n${request}` },
  ];
}

/** Generate schema-validated requirements for a request via the PageSpace brain. */
export async function generateRequirements(
  config: PageSpaceConfig,
  request: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Requirement[]> {
  const text = await completeViaBrain(config, buildRequirementsMessages(request), opts);
  return parseRequirements(text);
}

/** Register the `requirements` tool (a deterministically-invokable AIDD step). */
export function registerRequirementsTool(
  pi: { registerTool: (tool: any) => void },
  config: PageSpaceConfig,
): void {
  pi.registerTool({
    name: "requirements",
    label: "requirements",
    description:
      'Turn a development request into schema-validated "Given X, should Y" acceptance criteria via the PageSpace brain.',
    parameters: Type.Object({
      request: Type.String({ description: "The development request to derive requirements for." }),
    }),
    async execute(_id: string, params: { request: string }, signal?: AbortSignal) {
      const reqs = await generateRequirements(config, params.request, { signal });
      const text = reqs.length > 0 ? formatRequirements(reqs) : "(no requirements produced)";
      return { content: [{ type: "text", text }], details: { requirements: reqs } };
    },
  });
}
