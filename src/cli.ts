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
