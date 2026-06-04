/**
 * Live verification of the fix step (Epic 3): the brain diagnoses a simple off-by-one and proposes a
 * concrete fix. A model call; creates nothing.
 * Run: PAGESPACE_AUTH_TOKEN=... PAGESPACE_MODEL_PAGE=<brain> npx tsx test/run-fix.ts
 */
import { loadConfig } from "../src/config.ts";
import { proposeFix, formatFix } from "../src/fix.ts";

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

const FAILURE = "Test failed: expected sum([1, 2, 3]) to equal 6, but got 3.";
const CONTEXT =
  "function sum(arr) {\n  let total = 0;\n  for (let i = 0; i < arr.length - 1; i++) total += arr[i];\n  return total;\n}";

async function main(): Promise<void> {
  const proposal = await proposeFix(config, FAILURE, CONTEXT);
  console.log(proposal ? formatFix(proposal).replace(/^/gm, "    ") : "    (no proposal)");
  ok("returns a parseable proposal", proposal !== null);
  ok(
    "diagnosis or fix references the loop bound / off-by-one",
    !!proposal &&
      /length|off.?by.?one|<=|- 1|boundary|iterat/i.test(`${proposal.diagnosis} ${proposal.fix.change}`),
  );

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
