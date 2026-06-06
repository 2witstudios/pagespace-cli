/**
 * Live integration test for session sync (out of CI — needs PAGESPACE_AUTH_TOKEN + PAGESPACE_DRIVE +
 * PAGESPACE_MODEL_PAGE). Exercises the incremental (append-only) sync end to end against the real
 * drive: create → incremental appends → cross-machine reconcile (a FRESH process appends to the same
 * page) → full re-render, asserting the resumed JSONL stays byte-identical throughout. Cleans up.
 *
 * Run: npx tsx test/run-session-sync.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PageSpaceApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { loadDotenv } from "../src/env.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { jsonlLines, listAgentSessions, pullSession, pushSession } from "../src/session-sync.ts";

loadDotenv();
const config = loadConfig();
const driveSlug = config.defaultDriveSlug;
const agentPageId = config.modelPageId;
assert.ok(
  driveSlug && agentPageId && config.authToken,
  "PAGESPACE_DRIVE + PAGESPACE_MODEL_PAGE + token required",
);

const api = new PageSpaceApi(config);
const resolver = new PageSpaceResolver(api);
const userMsg = (i: number) =>
  JSON.stringify({
    type: "message",
    id: `u${i}`,
    message: { role: "user", content: [{ type: "text", text: `turn ${i}` }] },
  });
const localJsonl = (file: string) => jsonlLines(fs.readFileSync(file, "utf8")).join("\n");

// Subprocess mode: a single push in a FRESH module (empty in-memory offset Map) — used to prove that a
// second machine reconciles its offset from the remote page and appends only the new lines.
const argv = process.argv.slice(2);
if (argv[0] === "--push-once") {
  const [, file, sid] = argv;
  const p = await pushSession(api, resolver, driveSlug as string, agentPageId as string, sid, { file });
  process.stdout.write(JSON.stringify({ created: p?.created ?? null }));
  process.exit(0);
}

let pass = 0;
let total = 0;
const ok = (name: string, cond: boolean) => {
  total++;
  if (cond) pass++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
};

const sid = `019e0000-incr-7000-aaaa-${Date.now().toString(16).slice(-12)}`;
const ts = new Date().toISOString();
const file = path.join(os.tmpdir(), `${ts.replace(/[:.]/g, "-")}_${sid}.jsonl`);
const header = JSON.stringify({ type: "session", version: 3, id: sid, timestamp: ts, cwd: process.cwd() });
fs.writeFileSync(file, `${header}\n${userMsg(1)}\n`);

console.log("[1] create");
const p1 = await pushSession(api, resolver, driveSlug, agentPageId, sid, { file });
ok("create returns created:true", p1?.created === true);
const pageId = p1?.pageId as string;

console.log("[2] incremental appends (same process)");
fs.appendFileSync(file, `${userMsg(2)}\n`);
const p2 = await pushSession(api, resolver, driveSlug, agentPageId, sid, { file });
ok("second push is an update, not a re-create", p2?.created === false);
fs.appendFileSync(file, `${userMsg(3)}\n`);
await pushSession(api, resolver, driveSlug, agentPageId, sid, { file });
ok(
  "3 turns → resume byte-identical",
  (await pullSession(api, resolver, driveSlug, agentPageId, sid)) === localJsonl(file),
);

console.log("[3] cross-machine reconcile (fresh process appends turn 4)");
fs.appendFileSync(file, `${userMsg(4)}\n`);
const child = spawnSync("npx", ["tsx", fileURLToPath(import.meta.url), "--push-once", file, sid], {
  encoding: "utf8",
  env: process.env,
});
ok("fresh-process push exited 0", child.status === 0);
ok(
  "cross-machine append → byte-identical (offset reconciled from remote)",
  (await pullSession(api, resolver, driveSlug, agentPageId, sid)) === localJsonl(file),
);

console.log("[4] full re-render");
const p5 = await pushSession(api, resolver, driveSlug, agentPageId, sid, { file, full: true });
ok("full re-render is an update", p5?.created === false);
ok(
  "full re-render → byte-identical",
  (await pullSession(api, resolver, driveSlug, agentPageId, sid)) === localJsonl(file),
);

const listed = await listAgentSessions(api, resolver, driveSlug, agentPageId);
ok(
  "listed by full id",
  listed.some((s) => s.id === sid),
);

await api.trashPage(pageId);
fs.unlinkSync(file);
console.log(`\n${pass}/${total} assertions passed`);
process.exit(pass === total ? 0 : 1);
