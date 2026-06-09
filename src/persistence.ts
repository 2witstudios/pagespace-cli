/**
 * Auto-persist on lifecycle (Epic 2) — deterministic memory write-back.
 *
 * On `agent_end` (the agent finished handling a request) we append a concise entry to the drive's
 * `Activity Log` page, so progress is durably recorded without the model having to remember to
 * write it. Append-only via the documents `insert`-at-end op (single-writer-friendly: never a
 * read-modify-write of a shared page).
 *
 * NOTE: the requirement's "update task status automatically" half needs to know WHICH task is being
 * worked — that task context only exists inside the spec-gated /build loop (Epic 4), which reuses
 * `api.update_task` at that point. This leaf delivers the Activity-Log persistence mechanism.
 *
 * Pure helpers (message extraction, entry formatting) are unit-tested; the append is live-tested.
 */
import type { PageSpaceApi } from "./api.ts";
import type { PageSpaceResolver } from "./resolve.ts";

interface MessageLike {
  role?: string;
  content?: unknown;
}

/** Defensive text extraction from a pi message's content (string or content-block array). */
export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text: string } => {
        const b = c as { type?: unknown; text?: unknown };
        return b?.type === "text" && typeof b.text === "string";
      })
      .map((c) => c.text)
      .join("");
  }
  return "";
}

/** Extract the touched file path from a tool call block, if applicable. */
function fileFromToolCall(name: string, args: Record<string, unknown>): string | null {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "read":
      return s(args.path) || null;
    case "write":
    case "edit":
      return s(args.file_path) || null;
    default:
      return null;
  }
}

export interface SessionEntryInput {
  /** The user request the agent just handled. */
  request: string;
  /** A short tail of the assistant's final answer. */
  summary: string;
  /** Number of tool calls the assistant made. */
  toolCalls: number;
  /** Deduplicated list of files read or written during the turn. */
  files: string[];
}

/** Pull a loggable summary out of an agent_end message list, or null if there's nothing to log. */
export function extractEntryInput(messages: MessageLike[]): SessionEntryInput | null {
  let request = "";
  let summary = "";
  let toolCalls = 0;
  const fileSet = new Set<string>();
  for (const m of messages) {
    if (m.role === "user") {
      const t = textFromContent(m.content).trim();
      if (t) request = t;
    } else if (m.role === "assistant") {
      const t = textFromContent(m.content).trim();
      if (t) summary = t;
      if (Array.isArray(m.content)) {
        for (const c of m.content) {
          const block = c as { type?: unknown; name?: unknown; arguments?: unknown };
          if (block?.type !== "toolCall") continue;
          toolCalls++;
          const name = typeof block.name === "string" ? block.name : "";
          const args = (block.arguments as Record<string, unknown>) ?? {};
          const file = fileFromToolCall(name, args);
          if (file) fileSet.add(file);
        }
      }
    }
  }
  if (!request && !summary) return null;
  return { request, summary, toolCalls, files: [...fileSet] };
}

const clip = (s: string, n: number): string => {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
};

/** Format one concise, append-only Activity Log line. Pure. */
export function formatSessionEntry(timestamp: string, input: SessionEntryInput): string {
  const parts = [`- _${timestamp}_ — pi: "${clip(input.request, 120)}"`];
  if (input.files.length > 0) {
    const shown = input.files.slice(0, 5);
    const suffix = input.files.length > 5 ? ` +${input.files.length - 5}` : "";
    parts.push(`[${shown.join(", ")}${suffix}]`);
  }
  if (input.toolCalls > 0) parts.push(`${input.toolCalls} tool call${input.toolCalls === 1 ? "" : "s"}`);
  if (input.summary) parts.push(`→ ${clip(input.summary, 140)}`);
  return parts.join(" · ");
}

/**
 * Append text to a drive page (resolved by mount-relative path) using the insert-at-end op. Missing
 * pages are skipped (we never auto-create the Activity Log). A leading blank line separates entries.
 */
export async function appendToPage(
  api: PageSpaceApi,
  resolver: PageSpaceResolver,
  driveSlug: string,
  pagePath: string,
  text: string,
): Promise<boolean> {
  const r = await resolver.resolve(`${driveSlug}/${pagePath}`);
  if (!r.page) return false;
  await api.documents({ operation: "insert", pageId: r.page.id, startLine: 999_999, content: `\n${text}` });
  return true;
}
