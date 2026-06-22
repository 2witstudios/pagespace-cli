import { readCredentials, type CredentialRecord } from "./credentials.ts";

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
  /** Model specs — populated by PAGESPACE_MODEL_PAGE/PAGESPACE_MODEL_PAGES env or auto-discovery. */
  models?: { id: string; name?: string }[];
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

/**
 * Parse a drive set from env: PAGESPACE_DRIVES (comma-separated, the accessible drives) merged with
 * PAGESPACE_DRIVE (the bare-path default, kept first + deduped). Returns {drives, default}. Pure.
 *
 * `default` is what the dual-mount uses for bare paths (pagespace/... with no drive segment);
 * `drives` is the declared set the harness is aware of. A single PAGESPACE_DRIVE still works (the
 * common case) — it becomes a one-element set with itself as the default.
 */
export function parseDriveSet(env: {
  PAGESPACE_DRIVE?: string;
  PAGESPACE_DRIVES?: string;
}): { drives: string[]; default: string | undefined } {
  const single = env.PAGESPACE_DRIVE?.trim();
  const list = (env.PAGESPACE_DRIVES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const drives = [...new Set([...(single ? [single] : []), ...list])];
  return { drives, default: resolveDefaultDrive(env) };
}

/** Resolve the bare-path default drive: PAGESPACE_DRIVE wins, else the first of PAGESPACE_DRIVES. Pure. */
export function resolveDefaultDrive(env: {
  PAGESPACE_DRIVE?: string;
  PAGESPACE_DRIVES?: string;
}): string | undefined {
  const single = env.PAGESPACE_DRIVE?.trim();
  if (single) return single;
  return (env.PAGESPACE_DRIVES ?? "")
    .split(",")
    .map((s) => s.trim())
    .find(Boolean);
}

export function resolveAuthToken(
  env: NodeJS.ProcessEnv,
  readCredential: () => CredentialRecord | null = readCredentials,
): string | undefined {
  const envToken = env.PAGESPACE_AUTH_TOKEN?.trim();
  if (envToken) return envToken;
  return readCredential()?.token;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  readCredential: () => CredentialRecord | null = readCredentials,
): PageSpaceConfig {
  const configuredPrimary = env.PAGESPACE_MODEL_PAGE?.trim();
  const modelPageIds = (env.PAGESPACE_MODEL_PAGES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = [...new Set([...(configuredPrimary ? [configuredPrimary] : []), ...modelPageIds])];
  const modelPageId = ids[0];

  return {
    apiUrl: env.PAGESPACE_API_URL ?? "https://pagespace.ai",
    authToken: resolveAuthToken(env, readCredential),
    defaultDriveSlug: resolveDefaultDrive(env) ?? env.PAGESPACE_DRIVE,
    mountPrefix: env.PAGESPACE_MOUNT ?? "pagespace",
    modelPageId,
    models: ids.length > 0 ? ids.map((id) => ({ id })) : undefined,
    readOnlyPrefixes: (env.PAGESPACE_READONLY ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
