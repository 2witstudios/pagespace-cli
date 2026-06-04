import type { PageSpaceConfig } from "./config.ts";

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

/** Minimal authenticated client for the PageSpace REST API (scoped MCP token). */
export class PageSpaceApi {
  constructor(private readonly config: PageSpaceConfig) {}

  private async request<T = unknown>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.authToken) headers.Authorization = `Bearer ${this.config.authToken}`;
    const res = await fetch(`${this.config.apiUrl}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PageSpace ${method} ${endpoint} failed (${res.status}): ${text}`);
    }
    // Some endpoints (DELETE) may return an empty body.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
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
}
