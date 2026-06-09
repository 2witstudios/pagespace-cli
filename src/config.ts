/** Runtime configuration for the PageSpace companion, resolved from env. */
export interface PageSpaceConfig {
  /** Base URL of the PageSpace instance, e.g. https://pagespace.ai */
  apiUrl: string;
  /** Scoped MCP token (Bearer). Required for any PageSpace call. */
  authToken: string | undefined;
  /** Default drive slug the `pagespace/` mount points at (optional). */
  defaultDriveSlug: string | undefined;
  /** Path prefix under cwd that routes to PageSpace pages (default "pagespace"). */
  mountPrefix: string;
  /** AI_CHAT page id used as pi's model brain: ps-agent://<pageId> (back-compat alias). */
  modelPageId: string | undefined;
  /** One or more AI_CHAT page ids exposed as models (`pagespace/<id>`) for quick toggling via /model. */
  modelPageIds?: string[];
  /** Richer model specs with display names — populated by auto-discovery, takes precedence over modelPageIds in the provider. */
  models?: { id: string; name: string }[];
  /**
   * Mount sub-paths (within a drive) the dual-mount write/edit refuse — spec immutability for the
   * implementer role. E.g. ["Specs", "Epics"]. From PAGESPACE_READONLY (comma-separated). Optional;
   * empty/undefined = no restriction, so it never breaks setups that don't opt in. `loadConfig`
   * always sets it (possibly `[]`); hand-built configs may omit it.
   */
  readOnlyPrefixes?: string[];
  /**
   * Stable ID for this session's conversation in PageSpace. When set, every completions request
   * carries `conversation_id` + `client_manages_history: true` so messages are persisted under a
   * single conversation without the server overwriting pi's full context.
   * Injected at session start (not from env) — omit in `loadConfig`.
   */
  conversationId?: string;
}

export function loadConfig(): PageSpaceConfig {
  const configuredPrimary = process.env.PAGESPACE_MODEL_PAGE?.trim();
  const modelPageIds = (process.env.PAGESPACE_MODEL_PAGES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = [...new Set([...(configuredPrimary ? [configuredPrimary] : []), ...modelPageIds])];
  const modelPageId = ids[0];

  return {
    apiUrl: process.env.PAGESPACE_API_URL ?? "https://pagespace.ai",
    authToken: process.env.PAGESPACE_AUTH_TOKEN,
    defaultDriveSlug: process.env.PAGESPACE_DRIVE,
    mountPrefix: process.env.PAGESPACE_MOUNT ?? "pagespace",
    modelPageId,
    modelPageIds: ids,
    readOnlyPrefixes: (process.env.PAGESPACE_READONLY ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
