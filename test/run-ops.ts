/**
 * Live verification of the PageSpace-backed file operations against the real drive.
 * Run: PAGESPACE_API_URL=... PAGESPACE_AUTH_TOKEN=... PAGESPACE_DRIVE=pagespace-cli npx tsx test/run-ops.ts
 * Creates + trashes a `_optest` scratch folder; otherwise read-only on existing pages.
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { createPageSpaceOps } from "../src/ops.ts";

const apiUrl = process.env.PAGESPACE_API_URL ?? "https://pagespace.ai";
const authToken = process.env.PAGESPACE_AUTH_TOKEN;
const drive = process.env.PAGESPACE_DRIVE ?? "pagespace-cli";
const M = "/m";

if (!authToken) {
  console.error("PAGESPACE_AUTH_TOKEN is required");
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
const ops = createPageSpaceOps(api, resolver, { mountRoot: M });

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

const P = (rel: string): string => `${M}/${drive}/${rel}`;

async function main(): Promise<void> {
  // read existing page
  const overview = (await ops.read.readFile(P("Brain/overview"))).toString();
  ok("read Brain/overview content", overview.includes("# Overview"));

  // ls a folder
  const brainKids = await ops.ls.readdir(P("Brain"));
  ok("ls Brain includes overview", brainKids.includes("overview"));
  ok("ls Brain includes architecture", brainKids.includes("architecture"));

  // stat
  ok("stat Brain is dir", (await ops.ls.stat(P("Brain"))).isDirectory());
  ok("stat Brain/overview is file", !(await ops.ls.stat(P("Brain/overview"))).isDirectory());

  // exists
  ok("exists overview", await ops.ls.exists(P("Brain/overview")));
  ok("missing path !exists", !(await ops.ls.exists(P("Brain/__nope__"))));

  // create folder + page
  await ops.write.mkdir(P("_optest"));
  ok("mkdir _optest", await ops.ls.exists(P("_optest")));
  await ops.write.writeFile(P("_optest/note.md"), "# Note\n\nhello");
  const created = (await ops.read.readFile(P("_optest/note.md"))).toString();
  ok("read created note", created.includes("hello") && created.includes("# Note"));

  // edit (whole-content replace)
  await ops.edit.writeFile(P("_optest/note.md"), "# Note\n\nhello\nworld");
  ok("grep.readFile sees edit", (await ops.grep.readFile(P("_optest/note.md"))).includes("world"));

  // find glob
  const found = await ops.find.glob("*", P("_optest"), { ignore: [], limit: 100 });
  ok(
    "find glob finds note",
    found.some((f) => f.endsWith("/note.md")),
  );

  // ambiguity guard / not-found
  ok("isMountPath true under mount", ops.isMountPath(P("Brain")));
  ok("isMountPath false outside", !ops.isMountPath("/etc/hosts"));

  // cleanup
  const r = await resolver.resolve(`${drive}/_optest`);
  if (r.page) await api.trashPage(r.page.id);
  resolver.invalidate();
  ok("cleanup: _optest gone", !(await ops.ls.exists(P("_optest"))));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
