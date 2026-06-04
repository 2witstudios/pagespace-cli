/**
 * Live verification of mandatory review-as-gate (Epic 4): with a PASSING shell gate, a broken change
 * vs the rubric must NOT complete (review blocker), and a correct change must. Proves the review is a
 * real completion gate. Creates + trashes a scratch TASK_LIST `_completetest`.
 * Run: PAGESPACE_AUTH_TOKEN=... PAGESPACE_MODEL_PAGE=<brain> npx tsx test/run-complete.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { loadConfig } from "../src/config.ts";
import { gatedCompleteWithReview, formatCompleteResult } from "../src/complete.ts";

const config = loadConfig();
if (!config.authToken || !config.modelPageId) {
  console.error("PAGESPACE_AUTH_TOKEN and PAGESPACE_MODEL_PAGE are required");
  process.exit(2);
}
const drive = config.defaultDriveSlug ?? "pagespace-cli";
const api = new PageSpaceApi(config);
const resolver = new PageSpaceResolver(api);

let pass = 0;
let total = 0;
function ok(name: string, cond: boolean): void {
  total++;
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}`);
  }
}
const isDone = (s: string, g?: string): boolean => s === "completed" || g === "done" || s === "done";

const RUBRIC =
  "Given two numbers a and b, should return a divided by b.\nGiven b is 0, should throw an error.";

async function main(): Promise<void> {
  const d = await resolver.resolve(drive);
  const list = await api.createPage({
    driveId: d.driveId,
    title: "_completetest",
    type: "TASK_LIST",
    content: "scratch",
  });
  try {
    const taskId = (await api.createTask(list.id, "divide leaf")).id;

    // Passing shell gate, but broken work vs rubric → review blocks → not completed.
    const broken = await gatedCompleteWithReview(api, config, {
      listPageId: list.id,
      taskId,
      gates: ["exit 0"],
      cwd: process.cwd(),
      work: "function divide(a, b) { return a * b; }",
      rubric: RUBRIC,
    });
    console.log(`  [broken]\n${formatCompleteResult(broken).replace(/^/gm, "    ")}`);
    ok(
      "shell gate passes but review blocks completion",
      broken.gate.pass === true && broken.completed === false && broken.review?.pass === false,
    );
    const afterBroken = (await api.listTasks(list.id)).find((t) => t.id === taskId);
    ok(
      "task still NOT done after review block",
      !!afterBroken && !isDone(afterBroken.status, afterBroken.statusGroup),
    );

    // Correct work → gate + review pass → completed.
    const good = await gatedCompleteWithReview(api, config, {
      listPageId: list.id,
      taskId,
      gates: ["exit 0"],
      cwd: process.cwd(),
      work: "function divide(a, b) { if (b === 0) throw new Error('div by zero'); return a / b; }",
      rubric: RUBRIC,
    });
    console.log(`  [good]\n${formatCompleteResult(good).replace(/^/gm, "    ")}`);
    ok("gate + review pass → completed", good.completed === true && good.review?.pass === true);
    const afterGood = (await api.listTasks(list.id)).find((t) => t.id === taskId);
    ok(
      "task is done after gate + review pass",
      !!afterGood && isDone(afterGood.status, afterGood.statusGroup),
    );
  } finally {
    await api.trashPage(list.id).catch(() => {});
    resolver.invalidate();
  }
  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
