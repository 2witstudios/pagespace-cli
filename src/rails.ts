/**
 * Safety rails (Epic 4) — bounds for the autonomous build loop.
 *
 * A spec-gated loop must never relax the spec to pass, and must not retry forever. These pure
 * helpers track per-leaf attempts and a global step/token budget; the build driver consults them to
 * block a leaf after N failed gate attempts (→ escalate to the spec-owner) and to stop when the
 * budget is exhausted. Pure and fully unit-tested.
 */

export type AttemptLog = Map<string, number>;

export const DEFAULT_MAX_ATTEMPTS = 3;

/** Record one attempt for a leaf and return the new count. */
export function recordAttempt(log: AttemptLog, id: string): number {
  const n = (log.get(id) ?? 0) + 1;
  log.set(id, n);
  return n;
}

/** How many attempts a leaf has had. */
export function attemptCount(log: AttemptLog, id: string): number {
  return log.get(id) ?? 0;
}

/** True once a leaf has reached the attempt cap (block + escalate, never relax the spec). */
export function attemptsExceeded(log: AttemptLog, id: string, max = DEFAULT_MAX_ATTEMPTS): boolean {
  return attemptCount(log, id) >= max;
}

/** True while spending is under budget. An undefined budget means "no limit". */
export function withinBudget(spent: number, max: number | undefined): boolean {
  return max === undefined || max === null ? true : spent < max;
}
