/**
 * Spec + gate format (Epic 4) — the data a leaf's page carries so completion can be GATED.
 *
 * "Done" is enforced, not claimed. Each leaf's spec page holds `Given X, should Y` acceptance
 * criteria plus one or more runnable `gate:` commands (pass/fail). The gated `task_complete` tool and
 * the `/build` loop consume this: an agent never writes status directly — it requests completion,
 * the gate runs, and only a passing gate flips the task to done. This module is just the format +
 * parser (pure) + a live reader; running the gate and flipping status come in later leaves.
 *
 * Format (anywhere in the page body):
 *   - Given <situation>, should <observable behavior>
 *   gate: <shell command that exits 0 on pass>
 */
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";
import type { Requirement } from "./requirements.ts";

export interface Spec {
  criteria: Requirement[];
  /** Runnable pass/fail commands (exit 0 = pass). */
  gates: string[];
}

// Greedy "given" so commas inside the situation are kept; the trailing ", should …" ends it.
const GIVEN_RE = /^\s*[-*]?\s*given\s+(.+),\s*should\s+(.+?)\s*$/i;
const GATE_RE = /^\s*gate:\s*(.+?)\s*$/i;

/** Parse a spec page's text into acceptance criteria + gate commands. Pure. */
export function parseSpec(text: string): Spec {
  const criteria: Requirement[] = [];
  const gates: string[] = [];
  for (const line of text.split("\n")) {
    const gate = GATE_RE.exec(line);
    if (gate) {
      gates.push(gate[1].trim());
      continue;
    }
    const m = GIVEN_RE.exec(line);
    if (m) {
      const given = m[1].trim();
      const should = m[2].trim();
      if (given && should) criteria.push({ given, should });
    }
  }
  return { criteria, gates };
}

/** True when the spec is gateable (has at least one runnable gate). Pure. */
export function hasGate(spec: Spec): boolean {
  return spec.gates.length > 0;
}

/** Render a spec block (criteria bullets + gate lines). Pure; round-trips with parseSpec. */
export function formatSpec(spec: Spec): string {
  const lines: string[] = [];
  for (const c of spec.criteria) lines.push(`- Given ${c.given}, should ${c.should}`);
  for (const g of spec.gates) lines.push(`gate: ${g}`);
  return lines.join("\n");
}

/** Read a spec from a PageSpace page (mount-relative path) and parse it. */
export async function readSpec(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  pagePath: string,
): Promise<Spec> {
  const r = await resolver.resolve(`${driveSlug}/${pagePath}`);
  if (!r.page) throw new Error(`No spec page at "${pagePath}".`);
  return parseSpec(await api.readContent(r.page.id));
}
