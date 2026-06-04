/**
 * Live verification of lifecycle auto-persist (Epic 2): append to a SCRATCH page (never the real
 * Activity Log) and read it back. Creates + trashes `_persisttest`.
 * Run: PAGESPACE_AUTH_TOKEN=... npx tsx test/run-persistence.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { appendToPage, formatSessionEntry } from "../src/persistence.ts";

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

async function main(): Promise<void> {
  const driveObj = await resolver.resolve(drive);
  // Fresh scratch page.
  const created = await api.createPage({
    driveId: driveObj.driveId,
    title: "_persisttest",
    type: "DOCUMENT",
    content: "# Scratch log\n",
    contentMode: "markdown",
  });
  resolver.invalidate(driveObj.driveId);

  try {
    const e1 = formatSessionEntry("2026-06-04 00:00", {
      request: "first task",
      summary: "done one",
      toolCalls: 2,
    });
    const e2 = formatSessionEntry("2026-06-04 00:01", {
      request: "second task",
      summary: "done two",
      toolCalls: 0,
    });
    const a1 = await appendToPage(api, resolver, drive, "_persisttest", e1);
    const a2 = await appendToPage(api, resolver, drive, "_persisttest", e2);
    ok("append #1 reported success", a1);
    ok("append #2 reported success", a2);

    const content = await api.readContent(created.id);
    ok("original content preserved", content.includes("# Scratch log"));
    ok("entry #1 appended", content.includes('pi: "first task"') && content.includes("2 tool calls"));
    ok("entry #2 appended after #1", content.indexOf("second task") > content.indexOf("first task"));

    ok(
      "append to a missing page returns false (never auto-creates)",
      (await appendToPage(api, resolver, drive, "_no_such_page_xyz", "x")) === false,
    );
  } finally {
    await api.trashPage(created.id).catch(() => {});
    resolver.invalidate(driveObj.driveId);
  }

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
