/**
 * Live verification of compaction → durable memory (Epic 2): persist a summary to a SCRATCH page,
 * confirming create-on-first-use then append-on-subsequent. Creates + trashes `_compacttest`.
 * Run: PAGESPACE_AUTH_TOKEN=... npx tsx test/run-compaction.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { persistCompactionSummary } from "../src/compaction.ts";

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
const PATH = "_compacttest";

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
  try {
    // First call creates the page.
    const p1 = await persistCompactionSummary(api, resolver, drive, {
      summary: "summary one: built the thing",
      tokensBefore: 100000,
      path: PATH,
      timestamp: "2026-06-04 00:00",
    });
    ok("first persist returns the page path (created)", p1 === PATH);

    // Second call appends.
    await persistCompactionSummary(api, resolver, drive, {
      summary: "summary two: built more",
      tokensBefore: 120000,
      path: PATH,
      timestamp: "2026-06-04 00:01",
    });

    const r = await resolver.resolve(`${drive}/${PATH}`);
    const content = await api.readContent(r.page!.id);
    ok("created with the Session summaries header", content.includes("# Session summaries"));
    ok(
      "first summary present with token tag",
      content.includes("summary one: built the thing") && content.includes("100000 tokens before"),
    );
    ok(
      "second summary appended after first",
      content.indexOf("summary two") > content.indexOf("summary one"),
    );

    // Empty summary is a no-op.
    const pNone = await persistCompactionSummary(api, resolver, drive, { summary: "   ", path: PATH });
    ok("empty summary is a no-op", pNone === null);
  } finally {
    const r = await resolver.resolve(`${drive}/${PATH}`).catch(() => null);
    if (r?.page) await api.trashPage(r.page.id).catch(() => {});
    resolver.invalidate();
  }

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
