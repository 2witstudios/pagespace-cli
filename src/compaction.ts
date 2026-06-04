/**
 * Compaction → durable memory (Epic 2).
 *
 * When pi compacts a session's context, the generated summary is the only surviving record of the
 * earlier work. pi keeps it in the session file; here we also route it to a durable PageSpace page
 * (`Sessions`) so the knowledge outlives the session and is reachable by any stateless agent.
 *
 * The summary exists in the `session_compact` event (`compactionEntry.summary`) — fired AFTER
 * compaction — not in `session_before_compact` (which runs in the preparation phase, before a
 * summary exists). Append-only via the documents insert-at-end op; the `Sessions` page is created
 * on first use (it's a dedicated, harness-owned log, unlike the curated Activity Log).
 *
 * Pure formatting is unit-tested; the append/create is live-tested.
 */
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";
import { appendToPage } from "./persistence.ts";

/** The default durable page (mount-relative) for compaction summaries. */
export const SESSIONS_PAGE = "Sessions";

/** Format one durable compaction section. Pure. */
export function formatCompactionSummary(timestamp: string, tokensBefore: number, summary: string): string {
  return `\n## ${timestamp} — context compaction (${tokensBefore} tokens before)\n\n${summary.trim()}`;
}

export interface CompactionInput {
  summary: string;
  tokensBefore?: number;
  /** Override the target page (mount-relative). */
  path?: string;
  /** Injected for testability; defaults to now. */
  timestamp?: string;
}

/**
 * Persist a compaction summary to the durable `Sessions` page, creating it on first use. No-op for
 * an empty summary. Returns the page path written, or null when nothing was written.
 */
export async function persistCompactionSummary(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  input: CompactionInput,
): Promise<string | null> {
  const summary = input.summary?.trim();
  if (!summary) return null;
  const path = input.path ?? SESSIONS_PAGE;
  const ts = input.timestamp ?? new Date().toISOString().slice(0, 16).replace("T", " ");
  const section = formatCompactionSummary(ts, input.tokensBefore ?? 0, summary);

  const appended = await appendToPage(api, resolver, driveSlug, path, section);
  if (appended) return path;

  // Page doesn't exist yet — create the dedicated durable log.
  const r = await resolver.resolve(`${driveSlug}/${path}`);
  await api.createPage({
    driveId: r.driveId,
    title: r.title,
    type: "DOCUMENT",
    parentId: r.parentId,
    content: `# Session summaries\n\nDurable context-compaction summaries written by the harness.\n${section}`,
    contentMode: "markdown",
  });
  resolver.invalidate(r.driveId);
  return path;
}
