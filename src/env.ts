/**
 * Tiny, dependency-free dotenv loader for the harness.
 *
 * The project gitignores `.env` / `.env.*`, and the pi extension + the `pagespace` launcher read
 * their config from `process.env` (`PAGESPACE_AUTH_TOKEN`, `PAGESPACE_MODEL_PAGE`, …). But pi loads
 * the extension in-process without sourcing any `.env`, so the brain provider only registered when
 * the user happened to export those vars in the shell. This loads them deterministically from a
 * project `.env` / `.env.local` at startup so plain `pi` (and `pagespace`) just work.
 *
 * Precedence (highest first): the real shell env → `.env.local` → `.env`. The shell always wins, so
 * an exported secret is never overridden by a file; `.env.local` (gitignored, machine-specific)
 * overrides the shared `.env`. Only keys not already set are applied — never clobber a live value.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Env keys that carry a secret and must NEVER be inherited by a spawned child (e.g. pi) whose
 * tools (bash) could otherwise read them via `env`/`printenv`/`/proc/self/environ`. Token
 * isolation: the agent must never see the PageSpace auth token. The provider reads the token
 * from config, not from the child's process env.
 */
export const SECRET_ENV_KEYS = ["PAGESPACE_AUTH_TOKEN"] as const;

/**
 * Return a copy of `env` with all secret-bearing keys removed — safe to pass to `spawn` so a child
 * process (and its tools) cannot exfiltrate the auth token. Non-mutating. Pure.
 */
export function sanitizeChildEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const key of SECRET_ENV_KEYS) delete out[key];
  return out;
}

/**
 * Parse a dotenv-style file body into key/value pairs. Pure.
 * Skips blanks and `#` comments, tolerates a leading `export `, strips one layer of matching
 * single/double quotes, and ignores inline `#` comments on unquoted values. Last value wins.
 */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2];
    const quoted =
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2);
    if (quoted) {
      val = val.slice(1, -1);
    } else {
      // strip a trailing inline comment from an unquoted value
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash);
      val = val.trim();
    }
    out[m[1]] = val;
  }
  return out;
}

/** Apply parsed vars into `env`, setting only keys that are unset/empty. Returns the keys applied. Pure-ish. */
export function applyEnv(parsed: Record<string, string>, env: NodeJS.ProcessEnv = process.env): string[] {
  const applied: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined || env[k] === "") {
      env[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

/** The nearest directory at or above `startDir` that contains a `.env` or `.env.local`, else null. */
export function findEnvDir(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".env")) || fs.existsSync(path.join(dir, ".env.local"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Load `.env` then `.env.local` from the nearest enclosing dir into `env`, shell env winning.
 * Returns the list of keys actually applied (for an optional startup log). Safe to call repeatedly.
 */
export function loadDotenv(startDir: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = findEnvDir(startDir);
  if (!dir) return [];
  const applied: string[] = [];
  // `.env.local` first so it wins over `.env` (applyEnv only sets unset keys).
  for (const file of [".env.local", ".env"]) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    try {
      applied.push(...applyEnv(parseEnvFile(fs.readFileSync(p, "utf8")), env));
    } catch {
      /* unreadable file — ignore, fall back to whatever env already holds */
    }
  }
  return applied;
}
