/**
 * Branded `pagespace` CLI entrypoint (Epic 5).
 *
 * `pagespace [...args]` is a thin launcher: it starts `pi` with this package's extension preloaded
 * (`-e <extensions/pagespace.ts>`) and passes the user's args through. So a user gets a PageSpace-
 * native pi (dual-mount files + the PageSpace brain + the AIDD/build tools) under one branded
 * command, without having to remember the `-e` flag. The actual spawn lives in `bin/pagespace.mjs`
 * (plain Node, no TS loader needed); the pure arg/path construction lives here and is unit-tested,
 * and the bin mirrors it.
 *
 * (A future custom SessionManager — to persist sessions as PageSpace conversations, the deferred
 * Epic-2 leaf — would also be wired here, where we control how pi is launched.)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The pi launch args that preload this package's extension, then the user's args. Pure. */
export function buildPiLaunchArgs(extensionPath: string, userArgs: string[]): string[] {
  return ["-e", extensionPath, ...userArgs];
}

/** Resolve `<packageRoot>/extensions/pagespace.ts` from the bin's `import.meta.url` (bin/ is one level down). */
export function resolveExtensionPath(fromBinUrl: string): string {
  return path.join(path.dirname(fileURLToPath(fromBinUrl)), "..", "extensions", "pagespace.ts");
}

export interface ConfigCheck {
  /** True when all required config is present. */
  ok: boolean;
  /** Required keys that are unset. */
  missing: string[];
  /** Human-readable report lines. */
  lines: string[];
}

const CONFIG_KEYS: { key: string; required: boolean; label: string }[] = [
  { key: "PAGESPACE_AUTH_TOKEN", required: true, label: "scoped MCP token (Bearer)" },
  { key: "PAGESPACE_API_URL", required: false, label: "instance URL (default https://pagespace.ai)" },
  { key: "PAGESPACE_DRIVE", required: false, label: "default drive slug (mount + memory)" },
  { key: "PAGESPACE_MODEL_PAGE", required: false, label: "brain agent page id (ps-agent://<id>)" },
  {
    key: "PAGESPACE_MODEL_PAGES",
    required: false,
    label: "comma-separated brain agent ids for /model toggling",
  },
];

/** Validate the PageSpace env config and produce a report. Pure; the `status` subcommand mirrors this. */
export function checkConfig(env: Record<string, string | undefined>): ConfigCheck {
  const missing: string[] = [];
  const lines: string[] = ["pagespace config:"];
  for (const { key, required, label } of CONFIG_KEYS) {
    const set = !!env[key]?.trim();
    if (!set && required) missing.push(key);
    const mark = set ? "✓" : required ? "✗" : "·";
    lines.push(`  ${mark} ${key}${set ? "" : ` (unset — ${label})`}`);
  }
  const ok = missing.length === 0;
  if (!ok) lines.push("  → copy .mcp.json.example to .mcp.json and set your token, or export the env vars.");
  return { ok, missing, lines };
}
