import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEnv, parseEnvFile } from "../../src/env.ts";

test("parseEnvFile: parses KEY=VALUE, skips blanks and # comments", () => {
  const parsed = parseEnvFile(
    "# a comment\n\nPAGESPACE_AUTH_TOKEN=mcp_abc123\nPAGESPACE_DRIVE=pagespace-cli\n",
  );
  assert.deepEqual(parsed, {
    PAGESPACE_AUTH_TOKEN: "mcp_abc123",
    PAGESPACE_DRIVE: "pagespace-cli",
  });
});

test("parseEnvFile: tolerates `export `, surrounding quotes, and inline comments", () => {
  const parsed = parseEnvFile(
    [
      'export PAGESPACE_API_URL="https://pagespace.ai"',
      "PAGESPACE_MODEL_PAGE='xi9jg89d1qf40km2l29043yy'",
      "PAGESPACE_MOUNT=pagespace # the mount prefix",
    ].join("\n"),
  );
  assert.equal(parsed.PAGESPACE_API_URL, "https://pagespace.ai");
  assert.equal(parsed.PAGESPACE_MODEL_PAGE, "xi9jg89d1qf40km2l29043yy");
  assert.equal(parsed.PAGESPACE_MOUNT, "pagespace");
});

test("parseEnvFile: ignores malformed lines and keeps last value", () => {
  const parsed = parseEnvFile("not a kv line\nFOO=1\nFOO=2\n123BAD=x\n");
  assert.equal(parsed.FOO, "2");
  assert.equal("123BAD" in parsed, false);
});

test("applyEnv: sets only unset/empty keys — the live shell env wins", () => {
  const env: NodeJS.ProcessEnv = { PAGESPACE_AUTH_TOKEN: "shell-token", PAGESPACE_DRIVE: "" };
  const applied = applyEnv(
    { PAGESPACE_AUTH_TOKEN: "file-token", PAGESPACE_DRIVE: "from-file", PAGESPACE_MOUNT: "pagespace" },
    env,
  );
  assert.equal(env.PAGESPACE_AUTH_TOKEN, "shell-token"); // not overridden
  assert.equal(env.PAGESPACE_DRIVE, "from-file"); // empty → filled
  assert.equal(env.PAGESPACE_MOUNT, "pagespace"); // unset → filled
  assert.deepEqual(applied.sort(), ["PAGESPACE_DRIVE", "PAGESPACE_MOUNT"]);
});
