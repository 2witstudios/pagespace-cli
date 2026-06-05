/**
 * Live integration test for session sync (out of CI — needs PAGESPACE_AUTH_TOKEN + PAGESPACE_DRIVE +
 * PAGESPACE_MODEL_PAGE). Pushes a synthetic session under the agent, lists it, pulls it back
 * byte-identical, then trashes the test page. Run: `npx tsx test/run-session-sync.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PageSpaceApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { loadDotenv } from "../src/env.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { listAgentSessions, pullSession, pushSession } from "../src/session-sync.ts";

loadDotenv();
const config = loadConfig();
const driveSlug = config.defaultDriveSlug;
const agentPageId = config.modelPageId;
assert.ok(driveSlug, "PAGESPACE_DRIVE required");
assert.ok(agentPageId, "PAGESPACE_MODEL_PAGE required");
assert.ok(config.authToken, "PAGESPACE_AUTH_TOKEN required");

const api = new PageSpaceApi(config);
const resolver = new PageSpaceResolver(api);

const sid = `019e0000-test-7000-aaaa-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
const shortId = sid.slice(0, 8);
const ts = new Date().toISOString();
const jsonl = `${[
  JSON.stringify({ type: "session", version: 3, id: sid, timestamp: ts, cwd: process.cwd() }),
  JSON.stringify({
    type: "message",
    id: "u1",
    message: { role: "user", content: [{ type: "text", text: "session-sync live test prompt" }] },
  }),
  JSON.stringify({
    type: "message",
    id: "a1",
    message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
  }),
].join("\n")}\n`;

const tmp = path.join(os.tmpdir(), `${ts.replace(/[:.]/g, "-")}_${sid}.jsonl`);
fs.writeFileSync(tmp, jsonl);

const pushed = await pushSession(api, resolver, driveSlug, agentPageId, sid, {
  file: tmp,
  cwd: process.cwd(),
});
assert.ok(pushed, "pushSession returned a result");
console.log(`pushed: ${pushed.title} ${pushed.created ? "(created)" : "(updated)"}`);

const list = await listAgentSessions(api, resolver, driveSlug, agentPageId);
assert.ok(
  list.some((s) => s.shortId === shortId),
  "session appears under the agent's Sessions folder",
);

const pulled = await pullSession(api, resolver, driveSlug, agentPageId, shortId);
assert.equal(pulled, jsonl.trimEnd(), "pulled JSONL round-trips byte-identical");
console.log("round-trip OK (byte-identical)");

await api.trashPage(pushed.pageId);
fs.unlinkSync(tmp);
console.log("✓ session-sync live test passed (test page trashed)");
