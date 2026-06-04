/**
 * Live verification of readSpec (Epic 4): write a spec to a scratch page, read + parse it back.
 * Creates + trashes `_spectest`. Run: PAGESPACE_AUTH_TOKEN=... npx tsx test/run-spec.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { readSpec, formatSpec } from "../src/spec.ts";

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
  const d = await resolver.resolve(drive);
  const body = `# _spectest\n\nA throwaway leaf spec.\n\n${formatSpec({
    criteria: [{ given: "a spec page", should: "parse into criteria and gates" }],
    gates: ["npm run check"],
  })}\n`;
  const created = await api.createPage({
    driveId: d.driveId,
    title: "_spectest",
    type: "DOCUMENT",
    content: body,
    contentMode: "markdown",
  });
  resolver.invalidate(d.driveId);
  try {
    const spec = await readSpec(api, resolver, drive, "_spectest");
    console.log(`    criteria=${spec.criteria.length} gates=${JSON.stringify(spec.gates)}`);
    ok(
      "reads + parses the criterion",
      spec.criteria.length === 1 && spec.criteria[0].should.includes("criteria and gates"),
    );
    ok("reads + parses the gate", spec.gates.length === 1 && spec.gates[0] === "npm run check");
  } finally {
    await api.trashPage(created.id).catch(() => {});
    resolver.invalidate();
  }
  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
