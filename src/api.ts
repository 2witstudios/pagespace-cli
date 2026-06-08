import type { PageSpaceConfig } from "./config.ts";
import type { ConvMessage } from "./provider.ts";

export interface Drive {
  id: string;
  name: string;
  slug: string;
  role?: string;
  isOwned?: boolean;
}

export interface Page {
  id: string;
  title: string;
  type: string;
  parentId: string | null;
  position?: number;
  children?: Page[];
}

export type PageType = "FOLDER" | "DOCUMENT" | "CHANNEL" | "AI_CHAT" | "CANVAS" | "SHEET" | "TASK_LIST";

export interface DocumentResult {
  pageId: string;
  pageTitle: string;
  totalLines: number;
  numberedLines?: string[];
  content?: string;
}

export interface RegexMatch {
  pageId: string;
  title: string;
  type: string;
  semanticPath: string;
  matchingLines?: { lineNumber: number; content: string }[];
  totalMatches?: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  status: string;
  /** Status group (e.g. "todo" | "in_progress" | "done"). */
  statusGroup?: string;
  pageId?: string;
  [key: string]: unknown;
}

/** Transient HTTP statuses worth retrying (rate-limit + gateway/availability). */
const RETRIABLE_STATUS = new Set([429, 502, 503, 504]);

/** Whether a failure is transient and worth retrying: a retriable status, or a network/fetch error. Pure. */
export function isRetriable(status?: number, err?: unknown): boolean {
  if (status !== undefined) return RETRIABLE_STATUS.has(status);
  if (err === undefined) return false;
  if (err instanceof TypeError) return true; // fetch network failure surfaces as TypeError
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timed? ?out/i.test(
    msg,
  );
}

/** Exponential backoff with full-ish jitter, in [delay/2, delay] where delay = min(cap, base·2^attempt). Pure. */
export function retryDelayMs(attempt: number, base = 300, cap = 5000): number {
  const delay = Math.min(cap, base * 2 ** attempt);
  return delay / 2 + Math.random() * (delay / 2);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal authenticated client for the PageSpace REST API (scoped MCP token). */
export class PageSpaceApi {
  constructor(private readonly config: PageSpaceConfig) {}

  private async request<T = unknown>(
    method: string,
    endpoint: string,
    body?: unknown,
    maxRetries = 3,
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.authToken) headers.Authorization = `Bearer ${this.config.authToken}`;
    const url = `${this.config.apiUrl}${endpoint}`;
    const init = { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined };

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        // fetch threw → network error. Retry transient ones with backoff.
        if (isRetriable(undefined, err) && attempt < maxRetries) {
          await sleep(retryDelayMs(attempt));
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const text = await res.text();
        if (isRetriable(res.status) && attempt < maxRetries) {
          await sleep(retryDelayMs(attempt));
          continue;
        }
        throw new Error(`PageSpace ${method} ${endpoint} failed (${res.status}): ${text}`);
      }
      // Some endpoints (DELETE) may return an empty body.
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  listDrives(): Promise<Drive[]> {
    return this.request<Drive[]>("GET", "/api/drives");
  }

  /** Full hierarchical page tree for a drive (one call). */
  listPages(driveId: string): Promise<Page[]> {
    return this.request<Page[]>("GET", `/api/drives/${driveId}/pages`);
  }

  createPage(input: {
    driveId: string;
    title: string;
    type: PageType;
    parentId?: string | null;
    content?: string;
    contentMode?: "markdown" | "html";
  }): Promise<Page & { content?: string; contentMode?: string }> {
    return this.request("POST", "/api/pages", {
      driveId: input.driveId,
      title: input.title,
      type: input.type,
      parentId: input.parentId ?? null,
      content: input.content ?? "",
      ...(input.contentMode ? { contentMode: input.contentMode } : {}),
    });
  }

  /** Whole-page metadata/content update (title, content, parentId). */
  patchPage(
    pageId: string,
    patch: { title?: string; content?: string; parentId?: string | null },
  ): Promise<Page & { content?: string }> {
    return this.request("PATCH", `/api/pages/${pageId}`, patch);
  }

  /** Soft-delete (trash) a page. */
  trashPage(pageId: string): Promise<{ message?: string }> {
    return this.request("DELETE", `/api/pages/${pageId}`);
  }

  /** List the tasks on a TASK_LIST page (the `id` here is the real task id, not the linked page id). */
  async listTasks(listPageId: string): Promise<TaskRecord[]> {
    const r = await this.request<{ tasks?: TaskRecord[] }>("GET", `/api/pages/${listPageId}/tasks`);
    return r.tasks ?? [];
  }

  /** Create a task on a TASK_LIST page. */
  createTask(listPageId: string, title: string, extra: Record<string, unknown> = {}): Promise<TaskRecord> {
    return this.request<TaskRecord>("POST", `/api/pages/${listPageId}/tasks`, { title, ...extra });
  }

  /**
   * Set a task's status (e.g. "completed"). The server enforces the roll-up guard — a container task
   * can't complete while children are open (422 SUBTASKS_INCOMPLETE).
   */
  updateTaskStatus(listPageId: string, taskId: string, status: string): Promise<unknown> {
    return this.request("PATCH", `/api/pages/${listPageId}/tasks/${taskId}`, { status });
  }

  /** Line-addressable document ops. `insert` at a huge startLine appends. */
  documents(op: {
    operation: "read" | "replace" | "insert" | "delete";
    pageId: string;
    startLine?: number;
    endLine?: number;
    content?: string;
  }): Promise<DocumentResult> {
    return this.request("POST", "/api/mcp/documents", op);
  }

  /** Read a page's raw content (no line-number prefixes). */
  async readContent(pageId: string): Promise<string> {
    const r = await this.documents({ operation: "read", pageId });
    return r.content ?? "";
  }

  /** Server-side content/title regex search (used by grep). */
  regexSearch(
    driveId: string,
    pattern: string,
    searchIn: "content" | "title" | "both" = "content",
    maxResults = 50,
  ): Promise<{ results: RegexMatch[] }> {
    const qs = new URLSearchParams({ pattern, searchIn, maxResults: String(maxResults) });
    return this.request("GET", `/api/drives/${driveId}/search/regex?${qs.toString()}`);
  }

  /** List pi sessions for the agent page (GET /api/ai/page-agents/:agentId/conversations). */
  async listAgentConversations(agentId: string): Promise<
    {
      id: string;
      title: string;
      preview: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }[]
  > {
    const r = await this.request<{
      conversations?: {
        id: string;
        title: string;
        preview: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
      }[];
    }>("GET", `/api/ai/page-agents/${agentId}/conversations`);
    return r.conversations ?? [];
  }

  /** Get the full message list for a conversation (GET /api/v1/conversations/:id). */
  getConversation(conversationId: string): Promise<{ id: string; messages: ConvMessage[] }> {
    return this.request<{ id: string; messages: ConvMessage[] }>(
      "GET",
      `/api/v1/conversations/${conversationId}`,
    );
  }
}
