/**
 * Live verification of the requirements step (Epic 3): the PageSpace brain turns a request into
 * parseable Given/should criteria. Read-only (a model call; creates nothing).
 * Run: PAGESPACE_AUTH_TOKEN=... PAGESPACE_MODEL_PAGE=<brain> npx tsx test/run-requirements.ts
 */
import { loadConfig } from "../src/config.ts";
import { generateRequirements, formatRequirements } from "../src/requirements.ts";

const config = loadConfig();
if (!config.authToken || !config.modelPageId) {
  console.error("PAGESPACE_AUTH_TOKEN and PAGESPACE_MODEL_PAGE are required");
  process.exit(2);
}

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
  const reqs = await generateRequirements(
    config,
    "Add a `--dry-run` flag to the CLI that previews actions without writing any files.",
  );
  console.log(`  produced ${reqs.length} requirement(s):`);
  console.log(formatRequirements(reqs).replace(/^/gm, "    "));
  ok("produced at least one requirement", reqs.length > 0);
  ok(
    "every requirement has non-empty given + should",
    reqs.every((r) => r.given.length > 0 && r.should.length > 0),
  );
  ok(
    "at least one mentions dry-run/preview/write",
    reqs.some((r) => /dry.?run|preview|write|file/i.test(`${r.given} ${r.should}`)),
  );

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
