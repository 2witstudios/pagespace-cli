/**
 * Live verification of the gated task_complete (Epic 4): a failing gate must NOT complete a task; a
 * passing gate must. Proves no-self-complete. Creates + trashes a scratch TASK_LIST `_gatetest`.
 * Run: PAGESPACE_AUTH_TOKEN=... npx tsx test/run-gate.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { gatedComplete } from "../src/gate.ts";

const apiUrl = process.env.PAGESPACE_API_URL ?? "https://pagespace.ai";
const authToken = process.env.PAGESPACE_AUTH_TOKEN;
const drive = process.env.PAGESPACE_DRIVE ?? "pagespace-cli";
if (!authToken) {
  console.error("PAGESPACE_AUTH_TOKEN required");
  process.exit(2);
}

const api = new PageSpaceApi({
  apiUrl,
  authToken,
  defaultDriveSlug: drive,
  mountPrefix: "pagespace",
  modelPageId: undefined,
});
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

const isDone = (status: string, group?: string): boolean =>
  status === "completed" || group === "done" || status === "done";

async function main(): Promise<void> {
  const d = await resolver.resolve(drive);
  const list = await api.createPage({
    driveId: d.driveId,
    title: "_gatetest",
    type: "TASK_LIST",
    content: "scratch gate test",
  });
  try {
    const task = await api.createTask(list.id, "scratch leaf");
    const taskId = task.id;
    const cwd = process.cwd();

    // 1) Failing gate must NOT complete.
    const fail = await gatedComplete(api, { listPageId: list.id, taskId, gates: ["exit 1"], cwd });
    ok("failing gate does not complete", fail.completed === false && fail.pass === false);
    const afterFail = (await api.listTasks(list.id)).find((t) => t.id === taskId);
    ok(
      "task still NOT done after failing gate",
      !!afterFail && !isDone(afterFail.status, afterFail.statusGroup),
    );

    // 2) No gate must refuse to complete.
    const none = await gatedComplete(api, { listPageId: list.id, taskId, gates: [], cwd });
    ok("no gate => refuses to complete", none.completed === false && !!none.reason);

    // 3) Passing gate completes.
    const good = await gatedComplete(api, { listPageId: list.id, taskId, gates: ["exit 0"], cwd });
    ok("passing gate completes", good.completed === true && good.pass === true);
    const afterPass = (await api.listTasks(list.id)).find((t) => t.id === taskId);
    ok("task is done after passing gate", !!afterPass && isDone(afterPass.status, afterPass.statusGroup));
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
