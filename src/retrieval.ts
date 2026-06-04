/**
 * Per-turn Brain retrieval (Epic 2) — deterministic relevance injection.
 *
 * On each turn we derive keywords from the user's prompt, `regex_search` the drive's `Brain/` notes
 * for them, rank the matches, and inject the top few (within a char budget) into the system prompt.
 * This makes "use your memory" a built-in harness behaviour, not a tool the model may forget to call.
 *
 * The drive's regex_search is case-sensitive Postgres `~` with no line previews for non-literal
 * patterns, so we search with a case-folded keyword alternation to find candidate PAGES, then fetch
 * and rank them client-side. Pure helpers (keyword extraction, ranking, formatting) are unit-tested.
 */
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";
import { regexToCaseInsensitive } from "./ops.ts";

// Small, high-frequency words that add no retrieval signal.
const STOPWORDS = new Set(
  (
    "the a an and or but for nor yet so to of in on at by with from as is are was were be been being " +
    "this that these those it its their there here what which who whom how when where why will would " +
    "should could can may might must do does did done have has had not no yes you your i me my we our " +
    "they them he she his her if then else than into over under about above below out up down off again " +
    "just only also very more most some any all each both few many much one two please thanks lets let make " +
    "use using used need want like get got give given set put run runs running file files code"
  ).split(/\s+/),
);

export interface RetrievalOptions {
  /** Max notes to inject. */
  topK?: number;
  /** Total character budget across injected notes. */
  maxChars?: number;
  /** Max candidate pages to pull from the search before ranking. */
  maxResults?: number;
}
// maxResults is drive-wide (regex_search has no scope), so keep it generous: non-Brain pages
// (Activity Log, Epics, Codebase…) also match and would otherwise crowd Brain notes out of the cap
// before we filter to Brain/ below.
const DEFAULTS = { topK: 3, maxChars: 4000, maxResults: 40 } as const;

export interface RetrievedNote {
  /** Drive-relative path of the note, e.g. "Brain/architecture/model-brain". */
  source: string;
  content: string;
  score: number;
}

/** Extract distinct significant keywords from a prompt (lowercased, deduped, stopwords removed). */
export function buildBrainQuery(prompt: string, max = 8): string[] {
  const words = prompt.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 4 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Count case-insensitive occurrences of any keyword in text (for ranking). */
export function scoreContent(content: string, keywords: string[]): number {
  const lc = content.toLowerCase();
  let n = 0;
  for (const k of keywords) {
    let i = lc.indexOf(k);
    while (i !== -1) {
      n++;
      i = lc.indexOf(k, i + k.length);
    }
  }
  return n;
}

/** Rank notes by keyword score, drop zero-score, take topK, and trim total content to maxChars. */
export function rankAndTrim(
  notes: { source: string; content: string }[],
  keywords: string[],
  opts: RetrievalOptions = {},
): RetrievedNote[] {
  const { topK, maxChars } = { ...DEFAULTS, ...opts };
  const ranked = notes
    .map((n) => ({ ...n, score: scoreContent(n.content, keywords) }))
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  let budget = maxChars;
  const out: RetrievedNote[] = [];
  for (const n of ranked) {
    if (budget <= 0) break;
    const content = n.content.length > budget ? `${n.content.slice(0, budget)}\n…[trimmed]` : n.content;
    budget -= content.length;
    out.push({ ...n, content });
  }
  return out;
}

/** Render retrieved notes into a system-prompt block. Pure; "" when there is nothing to inject. */
export function formatRetrievedNotes(notes: RetrievedNote[]): string {
  if (notes.length === 0) return "";
  const blocks = notes
    .map(
      (n) => `<brain_note source="${n.source}" relevance="${n.score}">\n${n.content.trim()}\n</brain_note>`,
    )
    .join("\n\n");
  return ["# Relevant Brain notes for this turn (retrieved from PageSpace)", "", blocks].join("\n");
}

/** Search the drive's Brain for prompt-relevant notes and return the ranked, trimmed top matches. */
export async function retrieveBrainNotes(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  prompt: string,
  opts: RetrievalOptions = {},
): Promise<RetrievedNote[]> {
  const { maxResults } = { ...DEFAULTS, ...opts };
  const keywords = buildBrainQuery(prompt);
  if (keywords.length === 0) return [];

  const drive = await resolver.resolve(driveSlug);
  // Case-folded alternation: keywords are [a-z0-9_-] so no regex metachars to escape.
  const pattern = regexToCaseInsensitive(`(${keywords.join("|")})`);
  const { results } = await api.regexSearch(drive.driveId, pattern, "content", maxResults);

  // Only Brain *notes* (children of the Brain index), not the Brain index page itself.
  const candidates = results.filter((r) => r.semanticPath.includes("/Brain/"));
  const fetched: { source: string; content: string }[] = [];
  for (const r of candidates) {
    try {
      fetched.push({ source: r.semanticPath.replace(/^\/+/, ""), content: await api.readContent(r.pageId) });
    } catch {
      // skip unreadable pages
    }
  }
  return rankAndTrim(fetched, keywords, opts);
}
