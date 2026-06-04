/**
 * Live verification of the /build loop (Epic 4): buildNext skips a completed leaf, picks the active
 * one, loads its spec, and (with passing work) gate+review-completes it. Creates + trashes a scratch
 * epic TASK_LIST `_buildtest`.
 * Run: PAGESPACE_AUTH_TOKEN=... PAGESPACE_MODEL_PAGE=<brain> npx tsx test/run-build.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { loadConfig } from "../src/config.ts";
import { buildNext, formatBuildResult } from "../src/build.ts";

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

const SPEC =
  "- Given two numbers a and b, should return a divided by b\n- Given b is 0, should throw an error\ngate: exit 0";

async function main(): Promise<void> {
  const d = await resolver.resolve(drive);
  const list = await api.createPage({
    driveId: d.driveId,
    title: "_buildtest",
    type: "TASK_LIST",
    content: "scratch epic",
  });
  try {
    // Leaf 1: completed (must be skipped). Leaf 2: active, carrying a spec.
    const done = await api.createTask(list.id, "done leaf");
    await api.updateTaskStatus(list.id, done.id, "completed");
    await api.createTask(list.id, "active leaf");

    const active = (await api.listTasks(list.id)).find((t) => t.title === "active leaf");
    if (!active?.pageId) throw new Error("active task has no backing pageId");
    await api.patchPage(active.pageId, { content: SPEC });

    const cwd = process.cwd();

    // Human-in-loop: no work → surface the next leaf + its spec.
    const surfaced = await buildNext(api, config, { listPageId: list.id, cwd });
    console.log(`  [surface]\n${formatBuildResult(surfaced).replace(/^/gm, "    ")}`);
    ok("picks the ACTIVE leaf (skips the completed one)", surfaced.leaf?.id === active.id);
    ok(
      "loads the leaf's spec (2 criteria + gate)",
      surfaced.spec?.gates.join() === "exit 0" && surfaced.spec?.criteria.length === 2,
    );
    ok("no work => surfaced only, not completed", surfaced.result === undefined);

    // Autonomous: correct work → gate + review pass → completes the leaf.
    const built = await buildNext(api, config, {
      listPageId: list.id,
      cwd,
      work: "function divide(a, b) { if (b === 0) throw new Error('div by zero'); return a / b; }",
    });
    console.log(`  [build]\n${formatBuildResult(built).replace(/^/gm, "    ")}`);
    ok("gate + review pass → leaf completed", built.result?.completed === true);

    // Now every leaf is done.
    const after = await buildNext(api, config, { listPageId: list.id, cwd });
    ok("list complete after the last leaf passes", after.done === true);
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
