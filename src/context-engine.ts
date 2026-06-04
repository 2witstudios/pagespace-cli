/**
 * Deterministic context engine (Epic 2) — injects PageSpace drive state into every pi session.
 *
 * pi normally builds its system prompt from static AGENTS.md/CLAUDE.md. Here we make the drive the
 * memory substrate: on `before_agent_start` we append the project's north-star + index pages from
 * the PageSpace drive (Vision first, then the front-door `_index`, the Brain index, and the Epics
 * board) so a stateless agent always grounds on current drive state — not the model's discretion.
 *
 * Only small "index"/north-star pages are injected here (bounded token cost). Pulling specific
 * Brain notes by relevance is a separate concern (per-turn retrieval).
 */
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";

export interface ContextSection {
  /** Mount-relative path of the source page, e.g. "Vision" or "Epics/_index". */
  source: string;
  content: string;
}

/** The drive pages injected as standing context, in priority order (Vision is the primary injection). */
export const DEFAULT_CONTEXT_PAGES = ["Vision", "_index", "Brain", "Epics/_index"] as const;

/**
 * Render context sections into a single system-prompt block. Pure (no I/O) so it can be unit-tested.
 * Returns "" when there are no sections, so callers can append unconditionally.
 */
export function formatInjectedContext(sections: ContextSection[]): string {
  const nonEmpty = sections.filter((s) => s.content.trim().length > 0);
  if (nonEmpty.length === 0) return "";
  const blocks = nonEmpty
    .map((s) => `<pagespace_context source="${s.source}">\n${s.content.trim()}\n</pagespace_context>`)
    .join("\n\n");
  return [
    "# PageSpace drive context (injected, authoritative)",
    "",
    "Current state of this project's PageSpace drive. Treat it as the source of truth for the",
    "project's vision, conventions, knowledge index, and task board — ahead of your own memory.",
    "",
    blocks,
  ].join("\n");
}

/** Fetch the standing-context pages from the drive. Missing/unreadable pages are skipped. */
export async function fetchContextSections(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  pages: readonly string[] = DEFAULT_CONTEXT_PAGES,
): Promise<ContextSection[]> {
  const out: ContextSection[] = [];
  for (const source of pages) {
    try {
      const r = await resolver.resolve(`${driveSlug}/${source}`);
      if (!r.page) continue;
      const content = await api.readContent(r.page.id);
      if (content.trim()) out.push({ source, content });
    } catch {
      // A missing page or transient read error must never break session startup.
    }
  }
  return out;
}

export interface ContextEngine {
  /** The injected context block (fetched once per process, then cached). "" if nothing to inject. */
  get(): Promise<string>;
  /** Drop the cache so the next get() re-fetches (e.g. after the drive changes). */
  invalidate(): void;
}

export function createContextEngine(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  pages: readonly string[] = DEFAULT_CONTEXT_PAGES,
): ContextEngine {
  let cache: string | null = null;
  return {
    async get(): Promise<string> {
      if (cache === null) {
        cache = formatInjectedContext(await fetchContextSections(api, resolver, driveSlug, pages));
      }
      return cache;
    },
    invalidate(): void {
      cache = null;
    },
  };
}
