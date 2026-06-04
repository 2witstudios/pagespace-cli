/**
 * Live verification of review-as-gate (Epic 3): the brain returns a parseable verdict, and an
 * obviously-broken change fails the gate. A model call; creates nothing.
 * Run: PAGESPACE_AUTH_TOKEN=... PAGESPACE_MODEL_PAGE=<brain> npx tsx test/run-review.ts
 */
import { loadConfig } from "../src/config.ts";
import { review, formatVerdict } from "../src/review.ts";

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

const RUBRIC =
  "Given two numbers a and b, should return a divided by b.\nGiven b is 0, should throw an error.";

async function main(): Promise<void> {
  // Broken work: multiplies instead of divides, no zero check.
  const broken = await review(config, "function divide(a, b) { return a * b; }", RUBRIC);
  console.log(`  [broken]\n${formatVerdict(broken).replace(/^/gm, "    ")}`);
  ok(
    "broken change: verdict is well-formed",
    typeof broken.pass === "boolean" && Array.isArray(broken.issues),
  );
  ok("broken change fails the gate (pass=false)", broken.pass === false);

  // Correct work.
  const good = await review(
    config,
    "function divide(a, b) { if (b === 0) throw new Error('divide by zero'); return a / b; }",
    RUBRIC,
  );
  console.log(`  [good]\n${formatVerdict(good).replace(/^/gm, "    ")}`);
  ok("correct change: verdict is well-formed", typeof good.pass === "boolean" && Array.isArray(good.issues));
  ok("correct change passes the gate (pass=true)", good.pass === true);

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
