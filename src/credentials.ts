/**
 * Global credential store for the pagespace launcher — a token + API URL persisted under
 * `~/.pagespace/credentials` (0600) so the user never has to hand-edit `.env`/`.mcp.json`.
 *
 * Security (ADR ml803j05zgon3vt54mnmuz53): the token is isolated from the agent's process env
 * (the launcher scrubs it before spawn). The credential store is the source the provider reads
 * from. This module holds the PURE shaping/validation/parsing (unit-tested); the file I/O +
 * permission enforcement live in a thin wrapper and the `pagespace login` command in the launcher.
 */

/** The shape persisted to ~/.pagespace/credentials. */
export interface CredentialRecord {
  /** The scoped PageSpace MCP token (Bearer). */
  token: string;
  /** The instance URL this token is for. */
  apiUrl: string;
  /** ISO timestamp the credential was saved (for rotation prompts). */
  savedAt: string;
}

/** Canonical API URL when none is specified. */
export const DEFAULT_API_URL = "https://pagespace.ai";

/** The sorted list of keys a credential record carries. Pure. */
export const credentialRecordShape = ["token", "apiUrl", "savedAt"] as const;

/** Build a credential record from a captured token + optional metadata. Pure. */
export function buildCredentialRecord(input: {
  token: string;
  apiUrl?: string;
  now?: () => Date;
}): CredentialRecord {
  if (!input.token || !input.token.trim()) throw new Error("token is required");
  const apiUrl = (input.apiUrl ?? DEFAULT_API_URL).trim();
  if (!apiUrl) throw new Error("apiUrl is empty");
  return {
    token: input.token.trim(),
    apiUrl,
    savedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/** Parse a JSON credential-record body back into typed shape. Pure; throws on malformed input. */
export function parseCredentialRecord(body: string): CredentialRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("credential file is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("credential file is not a JSON object");
  }
  const rec = parsed as Partial<CredentialRecord>;
  const errs = validateCredentialRecord(rec);
  if (errs.length > 0) throw new Error(`invalid credential record: ${errs.join("; ")}`);
  return { token: rec.token!, apiUrl: rec.apiUrl!, savedAt: rec.savedAt! };
}

/** Validate a candidate credential record; returns a list of human-readable errors. Pure. */
export function validateCredentialRecord(rec: Partial<CredentialRecord>): string[] {
  const errs: string[] = [];
  if (typeof rec.token !== "string" || !rec.token.trim()) errs.push("token is missing");
  if (typeof rec.apiUrl !== "string" || !rec.apiUrl.trim()) errs.push("apiUrl is missing");
  else if (!/^https?:\/\//.test(rec.apiUrl)) errs.push("apiUrl must be an http(s) URL");
  if (typeof rec.savedAt !== "string" || !rec.savedAt.trim()) errs.push("savedAt is missing");
  return errs;
}

/** File-path + permission helpers for the credential store. Thin I/O wrappers over the pure core. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The pagespace config directory (~/.pagespace). */
export function pagespaceDir(): string {
  return path.join(os.homedir(), ".pagespace");
}

/** Path to the credential file (~/.pagespace/credentials). */
export function credentialsPath(): string {
  return path.join(pagespaceDir(), "credentials");
}

/**
 * Read the saved credential record, or null if none. Enforces 0600 on the file (refuses to load a
 * world/group-readable credential — defense in depth). Throws on a corrupt/unreadable file.
 */
export function readCredentials(path_ = credentialsPath()): CredentialRecord | null {
  if (!fs.existsSync(path_)) return null;
  const stat = fs.statSync(path_);
  const mode = stat.mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `credential file is too permissive (${mode.toString(8)}); expected 0600. Run: chmod 600 ${path_}`,
    );
  }
  return parseCredentialRecord(fs.readFileSync(path_, "utf8"));
}

/** Write a credential record to disk with 0600 perms, creating the dir. Returns the path written. */
export function writeCredentials(rec: CredentialRecord, path_ = credentialsPath()): string {
  fs.mkdirSync(path.dirname(path_), { recursive: true });
  fs.writeFileSync(path_, JSON.stringify(rec, null, 2), { mode: 0o600 });
  // chmod in case the file already existed with looser perms (writeFile respects umask on create only)
  fs.chmodSync(path_, 0o600);
  return path_;
}
