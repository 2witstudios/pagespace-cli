import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetriable, retryDelayMs } from "../../src/api.ts";

test("isRetriable: only 429 + gateway statuses are retriable; other 4xx/2xx are not", () => {
  for (const s of [429, 502, 503, 504]) assert.equal(isRetriable(s), true);
  for (const s of [200, 400, 401, 403, 404, 422, 500]) assert.equal(isRetriable(s), false);
});

test("isRetriable: network/fetch errors are retriable", () => {
  assert.equal(isRetriable(undefined, new TypeError("fetch failed")), true);
  assert.equal(isRetriable(undefined, new Error("read ECONNRESET")), true);
  assert.equal(isRetriable(undefined, new Error("connect ETIMEDOUT")), true);
  assert.equal(isRetriable(undefined, new Error("getaddrinfo ENOTFOUND host")), true);
  assert.equal(isRetriable(undefined, new Error("Unauthorized")), false);
  assert.equal(isRetriable(undefined, undefined), false);
});

test("retryDelayMs: grows with attempt, stays within [delay/2, delay], and is capped", () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const delay = Math.min(5000, 300 * 2 ** attempt);
    for (let i = 0; i < 20; i++) {
      const d = retryDelayMs(attempt);
      assert.ok(
        d >= delay / 2 - 1e-9 && d <= delay + 1e-9,
        `attempt ${attempt}: ${d} not in [${delay / 2}, ${delay}]`,
      );
    }
  }
  // Capped: a large attempt never exceeds the cap.
  assert.ok(retryDelayMs(20) <= 5000 + 1e-9);
});
