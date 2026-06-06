/**
 * Read-side session helpers shared by `bin/pagespace.mjs` (the `sessions`/`resume` subcommands).
 *
 * These mirror the canonical TypeScript versions in `src/session-sync.ts`, but live as plain JS because
 * the bin has no TS loader. `test/unit/bin-session-read.test.ts` round-trips these against the TS
 * `renderSessionPage` so the two can't silently drift. Keep this module side-effect-free (importable).
 */

/** Child FOLDER (under the agent page) that holds one DOCUMENT per session. */
export const SESSIONS_FOLDER = "Sessions";

/** Sentinels delimiting the embedded JSONL (must match src/session-sync.ts). */
export const JSONL_BEGIN = "<!--PI_SESSION_JSONL-->";
export const JSONL_END = "<!--/PI_SESSION_JSONL-->";

/** Reproduce pi's cwd → session-dir name: `--<cwd without leading slash, / \\ : → ->--`. */
export const encodeCwdDir = (cwd) => `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;

/**
 * Pull the exact JSONL back out of a rendered page. Reads from JSONL_BEGIN to end-of-page (current
 * open-ended format) or to JSONL_END when present (legacy), stripping the ```jsonl fence lines.
 */
export function extractJsonl(content) {
  const s = content.indexOf(JSONL_BEGIN);
  if (s === -1) return null;
  let region = content.slice(s + JSONL_BEGIN.length);
  const legacyEnd = region.indexOf(JSONL_END);
  if (legacyEnd !== -1) region = region.slice(0, legacyEnd);
  const inner = region.split("\n");
  while (inner.length && (inner[0].trim() === "" || /^```/.test(inner[0].trim()))) inner.shift();
  while (inner.length && (inner.at(-1).trim() === "" || /^```$/.test(inner.at(-1).trim()))) inner.pop();
  const body = inner.join("\n").trim();
  return body || null;
}

/** Parse the first JSONL line (the `{"type":"session",...}` header), or null. */
export function parseHeader(jsonl) {
  const first = jsonl.split("\n").find((l) => l.trim());
  try {
    const o = JSON.parse(first);
    if (o?.type === "session" && typeof o.id === "string") return o;
  } catch {
    /* not a header */
  }
  return null;
}

/** The full session id from a `${id} · ${preview}` page title (ids contain no spaces). */
export const sessionIdFromTitle = (title) => title.split(" · ")[0];

/** Exact full-id match wins; else a unique prefix. Multiple prefix hits → ambiguous (candidates). */
export function resolveSessionRef(sessions, ref) {
  const exact = sessions.find((s) => s.id === ref);
  if (exact) return { match: exact, candidates: [exact] };
  const candidates = sessions.filter((s) => s.id.startsWith(ref));
  return { match: candidates.length === 1 ? candidates[0] : undefined, candidates };
}
