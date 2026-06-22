/**
 * The `pagespace status` doctor — a reusable diagnostic + remediation layer.
 *
 * The pure core (`diagnose`) takes a config snapshot and returns structured checks (each with a
 * pass/fail + remediation hint); `formatDoctor` renders them. The launcher gathers the inputs
 * (token present? credential store present? reachable?) and calls these. Non-interactive/CI-safe:
 * `diagnose` is pure — it never prompts or blocks, just reports.
 */
import { DEFAULT_API_URL } from "./credentials.ts";

/** A single diagnostic check. */
export interface DoctorCheck {
  /** Stable id for the check (e.g. "token", "credentials", "apiUrl"). */
  id: string;
  /** Human label. */
  label: string;
  pass: boolean;
  /** Status detail (what was found). */
  detail: string;
  /** What to do when it fails (never empty on failure). */
  remediation: string;
}

/** Inputs to the doctor — a snapshot of the environment, gathered by the launcher. */
export interface DoctorInput {
  hasToken?: boolean;
  hasCredentials?: boolean;
  /** Instance URL (defaults to the canonical pagespace.ai). */
  apiUrl?: string;
  /** Result of a live auth ping (optional; when absent, that check is skipped). */
  reachable?: boolean;
  /** Count of drives the token can see (optional; for a reachable report). */
  driveCount?: number;
}

/** The resolved config the doctor normalized. */
export interface DoctorConfig {
  apiUrl: string;
}

/** A full doctor result. */
export interface DoctorResult {
  checks: DoctorCheck[];
  pass: boolean;
  config: DoctorConfig;
  /** Top-level remediation summary (the first failing check's action, or "" when all pass). */
  remediation: string;
}

/**
 * Run the diagnostic checks against a config snapshot. Pure: decides pass/fail + remediation per
 * check, aggregates, and returns structured results — never I/Os, never prompts.
 */
export function diagnose(input: DoctorInput): DoctorResult {
  const apiUrl = (input.apiUrl ?? DEFAULT_API_URL).trim() || DEFAULT_API_URL;
  const checks: DoctorCheck[] = [];

  // apiUrl check.
  const urlOk = /^https?:\/\//.test(apiUrl);
  checks.push({
    id: "apiUrl",
    label: "API URL",
    pass: urlOk,
    detail: apiUrl,
    remediation: "set PAGESPACE_API_URL to an http(s) URL (default: https://pagespace.ai).",
  });

  // token check — effective token resolved by the caller (env or credential store).
  // Uses input.hasToken only; the credential-store check is a separate check below so that a
  // credential file that exists but is corrupt/unreadable can't produce a false-green here.
  const hasToken = !!input.hasToken;
  checks.push({
    id: "token",
    label: "Auth token",
    pass: hasToken,
    detail: hasToken ? "present" : "unset",
    remediation: "run: pagespace login  (or export PAGESPACE_AUTH_TOKEN).",
  });

  // credentials check — credential-store presence (the Cursor-grade path).
  checks.push({
    id: "credentials",
    label: "Credential store",
    pass: !!input.hasCredentials,
    detail: input.hasCredentials ? "present (~/.pagespace/credentials)" : "not set",
    remediation: "run: pagespace login  to persist a token (0600).",
  });

  // reachable check — only when a ping was performed.
  if (input.reachable !== undefined) {
    checks.push({
      id: "reachable",
      label: "Reachable",
      pass: input.reachable,
      detail: input.reachable
        ? `${apiUrl} — ${input.driveCount ?? "?"} drive(s) visible`
        : `cannot reach ${apiUrl}`,
      remediation: `check the network, the URL, and the token scope against ${apiUrl}.`,
    });
  }

  const pass = checks.every((c) => c.pass);
  const firstFail = checks.find((c) => !c.pass);
  return { checks, pass, config: { apiUrl }, remediation: firstFail?.remediation ?? "" };
}

/** Render a doctor result as scannable text (✓/✗ per check + remediation on failure). Pure. */
export function formatDoctor(r: DoctorResult): string {
  const lines = ["pagespace status:"];
  for (const c of r.checks) {
    const mark = c.pass ? "✓" : "✗";
    lines.push(`  ${mark} ${c.label}: ${c.detail}`);
  }
  const failing = r.checks.filter((c) => !c.pass);
  if (failing.length > 0) {
    lines.push("  → fix:");
    for (const c of failing) lines.push(`    ${c.remediation}`);
  } else {
    lines.push("  → all checks passed.");
  }
  return lines.join("\n");
}
