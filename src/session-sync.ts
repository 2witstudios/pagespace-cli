/**
 * Cross-machine session resume (deferred Epic-2 "Sessions → PageSpace" leaf, reframed).
 *
 * pi owns the conversation loop; sessions are local append-only JSONL files at
 * `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl`. To let a user start on one machine and finish
 * on another, we MIRROR the session JSONL to a per-session page parented UNDER the Companion Agent (so
 * it reads as part of the agent, not a stray folder). On the other machine, `pagespace resume <id>`
 * pulls the JSONL back into the local session dir and `pi --session <id>` continues it natively — full
 * fidelity, no PageSpace backend change, no SessionManager replacement.
 *
 * Each page carries a best-effort readable transcript (for humans) + the EXACT JSONL between sentinels
 * (the source of truth for resume). The pure render/parse/encode helpers are unit-tested; the
 * push/list/pull live wrappers are live-tested. The read-side helpers (encode/extract) are mirrored in
 * plain JS in `bin/pagespace.mjs` for the `sessions`/`resume` subcommands (same split as cli.ts ↔ bin).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";

/** Child FOLDER (under the agent page) that holds one DOCUMENT per session. */
export const SESSIONS_FOLDER = "Sessions";

/** Sentinels delimiting the embedded JSONL — robust to backticks inside JSON, unlike a bare fence. */
export const JSONL_BEGIN = "<!--PI_SESSION_JSONL-->";
export const JSONL_END = "<!--/PI_SESSION_JSONL-->";

// ---------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------------------------------

/** Reproduce pi's cwd → session-dir name: `--<cwd without leading slash, / \\ : → ->--`. Pure. */
export function encodeCwdDir(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export interface SessionHeader {
  id: string;
  timestamp: string;
  cwd?: string;
}

/** Parse the first JSONL line (the `{"type":"session",...}` header). Pure. Null if absent/malformed. */
export function parseSessionHeader(jsonl: string): SessionHeader | null {
  const first = jsonl.split("\n").find((l) => l.trim());
  if (!first) return null;
  try {
    const o = JSON.parse(first) as { type?: string; id?: unknown; timestamp?: unknown; cwd?: unknown };
    if (o.type === "session" && typeof o.id === "string") {
      return {
        id: o.id,
        timestamp: typeof o.timestamp === "string" ? o.timestamp : "",
        cwd: typeof o.cwd === "string" ? o.cwd : undefined,
      };
    }
  } catch {
    /* not a header */
  }
  return null;
}

/** Canonical pi session filename from a header: `<ts with : . → ->_<id>.jsonl`. Pure. */
export function sessionFileName(header: SessionHeader): string {
  return `${header.timestamp.replace(/[:.]/g, "-")}_${header.id}.jsonl`;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text: string } => {
        const t = c as { type?: string; text?: unknown };
        return t.type === "text" && typeof t.text === "string";
      })
      .map((c) => c.text)
      .join("");
  }
  return "";
}

function toolCallsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const c of content) {
    const t = c as { type?: string; name?: string };
    if (t.type === "toolCall" && typeof t.name === "string") out.push(t.name);
  }
  return out;
}

export interface SessionMeta {
  id: string;
  shortId: string;
  title: string;
  preview: string;
  turns: number;
}

/** Derive id, a short title/preview (first user message), and a user-turn count. Pure. */
export function parseSessionMeta(jsonl: string): SessionMeta {
  let id = "";
  let preview = "";
  let turns = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let o: { type?: string; id?: string; message?: { role?: string; content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "session" && typeof o.id === "string") id = o.id;
    if (o.type === "message" && o.message?.role === "user") {
      turns++;
      if (!preview) preview = textOfContent(o.message.content);
    }
  }
  const shortId = id.slice(0, 8);
  preview = preview.replace(/\s+/g, " ").trim().slice(0, 60) || "(no prompt yet)";
  // The title LEADS with the full id (not the 8-char shortId): pi ids are uuidv7, whose first 8 hex
  // chars are a ~65s timestamp bucket, so two sessions started in the same minute share a shortId.
  // Matching/identity uses the full id (sessionIdFromTitle); the shortId is for display only.
  return { id, shortId, title: `${id} · ${preview}`, preview, turns };
}

/** The full session id from a `${id} · ${preview}` page title (ids contain no spaces). Pure. */
export function sessionIdFromTitle(title: string): string {
  return title.split(" · ")[0];
}

/**
 * Resolve a user-supplied session ref against the known sessions. An exact full-id match wins;
 * otherwise prefix matches are considered — a single hit is the match, multiple hits are returned as
 * `candidates` (ambiguous, e.g. a bare shortId), none → empty candidates. Pure.
 */
export function resolveSession(
  sessions: RemoteSession[],
  ref: string,
): { match?: RemoteSession; candidates: RemoteSession[] } {
  const exact = sessions.find((s) => s.id === ref);
  if (exact) return { match: exact, candidates: [exact] };
  const candidates = sessions.filter((s) => s.id.startsWith(ref));
  return { match: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

/** Best-effort readable transcript from the JSONL. Pure. Never throws; unknown entries are skipped. */
export function renderTranscript(jsonl: string): string {
  const out: string[] = [];
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let o: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "message" || !o.message) continue;
    const { role, content } = o.message;
    const text = textOfContent(content).replace(/\s+/g, " ").trim();
    if (role === "user") {
      if (text) out.push(`**User:** ${clip(text, 600)}`);
    } else if (role === "assistant") {
      if (text) out.push(`**Assistant:** ${clip(text, 600)}`);
      for (const name of toolCallsOf(content)) out.push(`  ↳ \`${name}\``);
    }
  }
  return out.length ? out.join("\n\n") : "_(no turns yet)_";
}

/**
 * Render the full per-session page: header + transcript snapshot, then the exact JSONL as the FINAL,
 * open-ended region (a `<!--PI_SESSION_JSONL-->` sentinel + an unclosed ```jsonl fence running to
 * end-of-page). Keeping the JSONL last lets incremental sync append new lines at end-of-page without
 * disturbing structure (see the Incremental session sync epic). Pure.
 */
export function renderSessionPage(jsonl: string, opts: { updatedAt: string; machine?: string }): string {
  const meta = parseSessionMeta(jsonl);
  const header = parseSessionHeader(jsonl);
  const lines = [
    `# Session ${meta.shortId} — ${meta.preview}`,
    "",
    `- **id:** \`${meta.id}\``,
    `- **turns:** ${meta.turns}`,
    `- **updated:** ${opts.updatedAt}`,
  ];
  if (header?.cwd) lines.push(`- **cwd:** \`${header.cwd}\``);
  if (opts.machine) lines.push(`- **machine:** ${opts.machine}`);
  lines.push(
    "",
    "## Transcript",
    "",
    renderTranscript(jsonl),
    "",
    "## Session data — do not edit",
    "",
    `\`pagespace resume ${meta.shortId}\` restores this session on another machine.`,
    "",
    JSONL_BEGIN,
    "```jsonl",
    jsonl.trimEnd(),
  );
  // Final newline only — no closing fence / JSONL_END, so the JSONL stays the open last region.
  return `${lines.join("\n")}\n`;
}

/**
 * Pull the exact JSONL back out of a rendered page. Reads from `JSONL_BEGIN` to end-of-page (the
 * open-ended current format), or to `JSONL_END` when present (the legacy closed format), stripping the
 * surrounding ```jsonl fence lines. A JSONL line is `{…}` and never a bare ``` fence, so the strip is
 * safe. Pure.
 */
export function extractJsonl(pageContent: string): string | null {
  const start = pageContent.indexOf(JSONL_BEGIN);
  if (start === -1) return null;
  let region = pageContent.slice(start + JSONL_BEGIN.length);
  const legacyEnd = region.indexOf(JSONL_END);
  if (legacyEnd !== -1) region = region.slice(0, legacyEnd);
  // Keep only JSONL lines: drop blanks and the ```jsonl fence lines. A JSONL line is `{…}`, never a
  // bare ``` — so this is safe AND tolerant of stray blank lines an incremental append may introduce.
  const body = region
    .split("\n")
    .filter((l) => l.trim() && !/^```/.test(l.trim()))
    .join("\n");
  return body.trim() ? body : null;
}

/** Non-empty JSONL lines (drops blank lines). Pure. */
export function jsonlLines(jsonl: string): string[] {
  return jsonl.split("\n").filter((l) => l.trim().length > 0);
}

export interface SyncDelta {
  /** Newline-joined lines to append (empty when nothing is new). */
  append: string;
  /** Total line count after this sync — the new synced offset. */
  total: number;
  /** True when `syncedLines` exceeds the local length (truncation/fork) → caller should full-render. */
  diverged: boolean;
}

/**
 * Given the local JSONL and how many lines were last synced, compute the tail to append. Append-only:
 * returns just `lines[syncedLines..]`. Pure.
 */
export function computeSyncDelta(localJsonl: string, syncedLines: number): SyncDelta {
  const lines = jsonlLines(localJsonl);
  if (syncedLines > lines.length) return { append: "", total: lines.length, diverged: true };
  return { append: lines.slice(syncedLines).join("\n"), total: lines.length, diverged: false };
}

/**
 * Reconcile the synced offset from the remote page's JSONL: how many leading lines of the local JSONL
 * are already present remotely (an append-only prefix). Returns -1 when the remote is NOT a prefix of
 * the local (mismatch, or remote ahead) so the caller full-renders instead of appending. Pure.
 */
export function reconcileSyncedLines(localJsonl: string, remoteJsonl: string | null): number {
  if (!remoteJsonl) return 0;
  const local = jsonlLines(localJsonl);
  const remote = jsonlLines(remoteJsonl);
  if (remote.length > local.length) return -1;
  for (let i = 0; i < remote.length; i++) {
    if (remote[i] !== local[i]) return -1;
  }
  return remote.length;
}

/** The decided sync action — pure output of `planSync`, executed by `pushSession`. */
export type SyncAction =
  | { kind: "create"; offset: number }
  | { kind: "full"; offset: number }
  | { kind: "append"; content: string; offset: number }
  | { kind: "noop"; offset: number };

/**
 * Decide how to sync a session to its page. Pure — `pushSession` does the I/O. `offset` is the
 * in-memory synced line count (null on the first push of a process); `remote` is the remote JSONL,
 * needed only to seed an unknown offset. Append-only by default; falls back to a full re-render when
 * forced (`full`), when the offset can't be reconciled (divergence/fork), or for a missing page.
 */
export function planSync(args: {
  exists: boolean;
  local: string;
  offset: number | null;
  remote?: string | null;
  full?: boolean;
}): SyncAction {
  const total = jsonlLines(args.local).length;
  if (!args.exists) return { kind: "create", offset: total };
  if (args.full) return { kind: "full", offset: total };
  let offset = args.offset;
  if (offset === null) {
    offset = reconcileSyncedLines(args.local, args.remote ?? null);
    if (offset === -1) return { kind: "full", offset: total };
  }
  const delta = computeSyncDelta(args.local, offset);
  if (delta.diverged) return { kind: "full", offset: total };
  if (!delta.append) return { kind: "noop", offset: total };
  return { kind: "append", content: delta.append, offset: delta.total };
}

/** pi's session directory for a cwd (honoring the PI_CODING_AGENT_SESSION_DIR override). Pure-ish (reads env). */
export function piSessionDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_CODING_AGENT_SESSION_DIR;
  if (override?.trim()) return override;
  return path.join(os.homedir(), ".pi", "agent", "sessions", encodeCwdDir(cwd));
}

/** Find the local JSONL file for a session id (matches `*_<id>.jsonl`, or any file whose header id matches). */
export function findLocalSessionFile(dir: string, sessionId: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = entries.find((f) => f.endsWith(".jsonl") && f.includes(`_${sessionId}`));
  return hit ? path.join(dir, hit) : null;
}

// ---------------------------------------------------------------------------------------------------
// Live wrappers (live-tested)
// ---------------------------------------------------------------------------------------------------

async function driveIdFor(resolver: PageSpaceResolver, driveSlug: string): Promise<string> {
  const r = await resolver.resolve(driveSlug);
  return r.driveId;
}

/** Ensure the `Sessions` FOLDER exists under the agent page; return its id. */
async function ensureSessionsFolder(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveId: string,
  agentPageId: string,
): Promise<string> {
  const existing = (await resolver.children(driveId, agentPageId)).find(
    (p) => p.title === SESSIONS_FOLDER && p.type === "FOLDER",
  );
  if (existing) return existing.id;
  const created = await api.createPage({
    driveId,
    title: SESSIONS_FOLDER,
    type: "FOLDER",
    parentId: agentPageId,
  });
  resolver.invalidate(driveId);
  return created.id;
}

export interface PushResult {
  pageId: string;
  title: string;
  created: boolean;
}

/** Per-session synced line count, in-process. Seeded from the remote page on the first push. */
const syncedLines = new Map<string, number>();

/**
 * Mirror the active session's local JSONL to a page under the agent (matched by full session id).
 * Append-only by default: only the lines added since the last sync are inserted at end-of-page (cheap
 * for long sessions); a full re-render runs when the page is new, when `opts.full` is set (refresh the
 * readable transcript — the cadence leaf), or when the offset can't be reconciled (divergence/fork).
 * No-op (null) when the local file isn't found. Best-effort: callers wrap in try/catch.
 */
export async function pushSession(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  agentPageId: string,
  sessionId: string,
  opts: { cwd?: string; file?: string; updatedAt?: string; machine?: string; full?: boolean } = {},
): Promise<PushResult | null> {
  // Prefer the exact path pi reports (ctx.sessionManager.getSessionFile()); else locate by id.
  const cwd = opts.cwd ?? process.cwd();
  const file =
    opts.file && fs.existsSync(opts.file) ? opts.file : findLocalSessionFile(piSessionDir(cwd), sessionId);
  if (!file) return null;
  const jsonl = fs.readFileSync(file, "utf8");
  if (!jsonl.trim()) return null;
  const meta = parseSessionMeta(jsonl);
  const render = () =>
    renderSessionPage(jsonl, {
      updatedAt: opts.updatedAt ?? new Date().toISOString().slice(0, 16).replace("T", " "),
      machine: opts.machine ?? os.hostname(),
    });

  const driveId = await driveIdFor(resolver, driveSlug);
  const folderId = await ensureSessionsFolder(api, resolver, driveId, agentPageId);
  // Match the existing page by FULL id (not shortId) so a same-minute sibling isn't overwritten.
  const existing = (await resolver.children(driveId, folderId)).find(
    (p) => sessionIdFromTitle(p.title) === sessionId,
  );

  const offset = existing ? (syncedLines.get(sessionId) ?? null) : null;
  // Seed an unknown offset from the remote page once (resume / cross-machine), reading it just this once.
  const remote =
    existing && offset === null
      ? await api
          .readContent(existing.id)
          .then(extractJsonl)
          .catch(() => null)
      : null;
  const plan = planSync({ exists: !!existing, local: jsonl, offset, remote, full: opts.full });

  if (!existing) {
    const created = await api.createPage({
      driveId,
      title: meta.title,
      type: "DOCUMENT",
      parentId: folderId,
      content: render(),
      contentMode: "markdown",
    });
    resolver.invalidate(driveId);
    syncedLines.set(sessionId, plan.offset);
    return { pageId: created.id, title: meta.title, created: true };
  }

  if (plan.kind === "append") {
    await api.documents({
      operation: "insert",
      pageId: existing.id,
      startLine: 1_000_000,
      content: `\n${plan.content}`,
    });
  } else if (plan.kind !== "noop") {
    await api.patchPage(existing.id, { content: render() }); // "full" (and the unreachable "create")
  }
  syncedLines.set(sessionId, plan.offset);
  return { pageId: existing.id, title: existing.title, created: false };
}

export interface RemoteSession {
  pageId: string;
  /** Full session id (the matching/identity key). */
  id: string;
  /** First 8 chars — for display only; NOT unique across same-minute sessions. */
  shortId: string;
  title: string;
}

/** List the session pages under the agent (children of its `Sessions` folder). */
export async function listAgentSessions(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  agentPageId: string,
): Promise<RemoteSession[]> {
  const driveId = await driveIdFor(resolver, driveSlug);
  const folder = (await resolver.children(driveId, agentPageId)).find(
    (p) => p.title === SESSIONS_FOLDER && p.type === "FOLDER",
  );
  if (!folder) return [];
  const kids = await resolver.children(driveId, folder.id);
  return kids
    .filter((p) => p.type === "DOCUMENT")
    .map((p) => {
      const id = sessionIdFromTitle(p.title);
      return { pageId: p.id, id, shortId: id.slice(0, 8), title: p.title };
    });
}

/**
 * Fetch a remote session's JSONL by id (exact or unambiguous prefix). Returns the JSONL, or null when
 * the ref matches no session or is ambiguous (use a longer id — `pagespace sessions` lists them).
 */
export async function pullSession(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  agentPageId: string,
  ref: string,
): Promise<string | null> {
  const sessions = await listAgentSessions(api, resolver, driveSlug, agentPageId);
  const { match } = resolveSession(sessions, ref);
  if (!match) return null;
  const content = await api.readContent(match.pageId);
  return extractJsonl(content);
}
