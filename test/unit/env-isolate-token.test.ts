import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeChildEnv, SECRET_ENV_KEYS } from "../../src/env.ts";

test("SECRET_ENV_KEYS includes the auth token", () => {
  assert.ok(SECRET_ENV_KEYS.includes("PAGESPACE_AUTH_TOKEN"));
});

test("sanitizeChildEnv removes secret keys", () => {
  const env = {
    PATH: "/usr/bin",
    PAGESPACE_AUTH_TOKEN: "mcp_secret_here",
    PAGESPACE_API_URL: "https://pagespace.ai",
    HOME: "/home/user",
  };
  const out = sanitizeChildEnv(env);
  assert.equal(out.PAGESPACE_AUTH_TOKEN, undefined, "token must be stripped");
  assert.equal(out.PAGESPACE_API_URL, "https://pagespace.ai", "non-secret kept");
  assert.equal(out.PATH, "/usr/bin");
  assert.equal(out.HOME, "/home/user");
});

test("sanitizeChildEnv does not mutate the input env", () => {
  const env = { PAGESPACE_AUTH_TOKEN: "mcp_secret", PATH: "/usr/bin" };
  sanitizeChildEnv(env);
  assert.equal(env.PAGESPACE_AUTH_TOKEN, "mcp_secret", "input untouched");
});

test("sanitizeChildEnv on env without secrets is a clean copy", () => {
  const env = { PATH: "/usr/bin" };
  const out = sanitizeChildEnv(env);
  assert.deepEqual(out, env);
  assert.notEqual(out, env, "returns a new object");
});

test("sanitizeChildEnv with PAGESPACE_AUTH_TOKEN empty still strips it (defense in depth)", () => {
  const env = { PAGESPACE_AUTH_TOKEN: "", PATH: "/usr/bin" };
  const out = sanitizeChildEnv(env);
  assert.equal(out.PAGESPACE_AUTH_TOKEN, undefined);
});
