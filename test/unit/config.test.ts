import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.ts";

test("loadConfig: falls back to credential store token when env token is unset", () => {
  const config = loadConfig(
    {
      PAGESPACE_API_URL: "https://pagespace.ai",
      PAGESPACE_AUTH_TOKEN: undefined,
    },
    () => ({
      token: "mcp_from_store",
      apiUrl: "https://pagespace.ai",
      savedAt: "2026-06-22T00:00:00.000Z",
    }),
  );
  assert.equal(config.authToken, "mcp_from_store");
});

test("loadConfig: authToken is undefined when env and credential store are both unset", () => {
  const config = loadConfig(
    {
      PAGESPACE_AUTH_TOKEN: undefined,
    },
    () => null,
  );
  assert.equal(config.authToken, undefined);
});

test("loadConfig: env token wins over credential store token", () => {
  const config = loadConfig(
    {
      PAGESPACE_AUTH_TOKEN: "mcp_env_token",
    },
    () => ({
      token: "mcp_store_token",
      apiUrl: "https://pagespace.ai",
      savedAt: "2026-06-22T00:00:00.000Z",
    }),
  );
  assert.equal(config.authToken, "mcp_env_token");
});

test("loadConfig: whitespace-only PAGESPACE_DRIVE does not leak into defaultDriveSlug", () => {
  const config = loadConfig({ PAGESPACE_DRIVE: "   " }, () => null);
  assert.equal(config.defaultDriveSlug, undefined);
});
