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
  return { id, shortId, title: `${shortId} · ${preview}`, preview, turns };
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

/** Render the full per-session page: header + transcript + the exact JSONL between sentinels. Pure. */
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
    "```",
    JSONL_END,
    "",
  );
  return lines.join("\n");
}

/** Pull the exact JSONL back out of a rendered page (between sentinels, fence lines stripped). Pure. */
export function extractJsonl(pageContent: string): string | null {
  const start = pageContent.indexOf(JSONL_BEGIN);
  const end = pageContent.indexOf(JSONL_END);
  if (start === -1 || end === -1 || end < start) return null;
  let body = pageContent.slice(start + JSONL_BEGIN.length, end);
  const inner = body.split("\n");
  // Drop the leading/trailing blank + fence lines the renderer adds (a JSONL line is `{...}`, never ```).
  while (inner.length && (inner[0].trim() === "" || /^```/.test(inner[0].trim()))) inner.shift();
  while (
    inner.length &&
    (inner[inner.length - 1].trim() === "" || /^```$/.test(inner[inner.length - 1].trim()))
  )
    inner.pop();
  body = inner.join("\n");
  return body.trim() ? body : null;
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

/**
 * Mirror the active session's local JSONL to a page under the agent. Reads the local file by session
 * id, upserts the per-session DOCUMENT (matched by short-id title prefix). No-op (null) if the local
 * file isn't found yet. Best-effort: callers wrap in try/catch so a sync failure never breaks a turn.
 */
export async function pushSession(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  agentPageId: string,
  sessionId: string,
  opts: { cwd?: string; file?: string; updatedAt?: string; machine?: string } = {},
): Promise<PushResult | null> {
  // Prefer the exact path pi reports (ctx.sessionManager.getSessionFile()); else locate by id.
  const cwd = opts.cwd ?? process.cwd();
  const file =
    opts.file && fs.existsSync(opts.file) ? opts.file : findLocalSessionFile(piSessionDir(cwd), sessionId);
  if (!file) return null;
  const jsonl = fs.readFileSync(file, "utf8");
  if (!jsonl.trim()) return null;
  const meta = parseSessionMeta(jsonl);
  const content = renderSessionPage(jsonl, {
    updatedAt: opts.updatedAt ?? new Date().toISOString().slice(0, 16).replace("T", " "),
    machine: opts.machine ?? os.hostname(),
  });

  const driveId = await driveIdFor(resolver, driveSlug);
  const folderId = await ensureSessionsFolder(api, resolver, driveId, agentPageId);
  const existing = (await resolver.children(driveId, folderId)).find((p) =>
    p.title.startsWith(`${meta.shortId} `),
  );
  if (existing) {
    await api.patchPage(existing.id, { content });
    return { pageId: existing.id, title: existing.title, created: false };
  }
  const created = await api.createPage({
    driveId,
    title: meta.title,
    type: "DOCUMENT",
    parentId: folderId,
    content,
    contentMode: "markdown",
  });
  resolver.invalidate(driveId);
  return { pageId: created.id, title: meta.title, created: true };
}

export interface RemoteSession {
  pageId: string;
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
    .map((p) => ({ pageId: p.id, shortId: p.title.split(" ")[0], title: p.title }));
}

/** Fetch a remote session's JSONL by short-id prefix. Returns the JSONL string, or null if not found. */
export async function pullSession(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  agentPageId: string,
  idPrefix: string,
): Promise<string | null> {
  const sessions = await listAgentSessions(api, resolver, driveSlug, agentPageId);
  const match = sessions.find((s) => s.shortId.startsWith(idPrefix) || idPrefix.startsWith(s.shortId));
  if (!match) return null;
  const content = await api.readContent(match.pageId);
  return extractJsonl(content);
}
