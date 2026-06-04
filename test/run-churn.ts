/**
 * Integration check of churn against this repo's real git history (local only — CI checks out
 * shallow history). No network. Run: npx tsx test/run-churn.ts
 */
import { computeChurn, formatChurn } from "../src/churn.ts";

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
  const entries = await computeChurn(process.cwd());
  console.log(formatChurn(entries, 8).replace(/^/gm, "    "));
  ok("returns churn entries", entries.length > 0);
  ok(
    "counts are positive and sorted desc",
    entries.every((e) => e.commits > 0) &&
      entries.every((e, i) => i === 0 || entries[i - 1].commits >= e.commits),
  );
  ok(
    "the heavily-edited extension is a hotspot",
    entries.some((e) => e.file === "extensions/pagespace.ts" && e.commits >= 2),
  );

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
