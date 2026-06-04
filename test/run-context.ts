/**
 * Live verification of the context engine (Epic 2): fetch the drive's standing-context pages and
 * confirm the injected block contains the Vision + indexes. Read-only.
 * Run: PAGESPACE_AUTH_TOKEN=... npx tsx test/run-context.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { createContextEngine, fetchContextSections } from "../src/context-engine.ts";

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
function ok(name: string, cond: boolean, extra = ""): void {
  total++;
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  const sections = await fetchContextSections(api, resolver, drive);
  const sources = sections.map((s) => s.source);
  console.log(`  fetched sections: ${sources.join(", ")}`);
  ok("Vision is fetched", sources.includes("Vision"));
  ok(
    "Vision content is the north star",
    /PageSpace-native/i.test(sections.find((s) => s.source === "Vision")?.content ?? ""),
  );
  ok("front-door _index fetched", sources.includes("_index"));
  ok("Epics/_index fetched", sources.includes("Epics/_index"));

  const engine = createContextEngine(api, resolver, drive);
  const block = await engine.get();
  ok("injected block has the authoritative header", /injected, authoritative/.test(block));
  ok("injected block wraps Vision", /<pagespace_context source="Vision">/.test(block));
  // Cache returns the same object without re-fetching.
  ok("cached get() returns identical content", (await engine.get()) === block);

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
