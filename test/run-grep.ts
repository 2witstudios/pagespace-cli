/**
 * Live verification of server-side grep (ops.grepSearch -> drive regex_search), against the real
 * drive. Read-only. Run: PAGESPACE_AUTH_TOKEN=... npx --yes tsx test/run-grep.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { createPageSpaceOps } from "../src/ops.ts";

const apiUrl = process.env.PAGESPACE_API_URL ?? "https://pagespace.ai";
const authToken = process.env.PAGESPACE_AUTH_TOKEN;
const drive = process.env.PAGESPACE_DRIVE ?? "pagespace-cli";
const M = "/m";
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
const ops = createPageSpaceOps(api, resolver, { mountRoot: M, defaultDriveSlug: drive });
const P = (rel: string) => `${M}/${drive}${rel ? `/${rel}` : ""}`;

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
  // 1) Scoped search under Brain -> path relative to the search dir (Brain).
  const r1 = await ops.grepSearch({ pattern: "# Overview", path: P("Brain") });
  const t1 = r1.content[0].text;
  console.log(
    `[Brain/# Overview]\n${t1
      .split("\n")
      .slice(0, 4)
      .map((l) => `    ${l}`)
      .join("\n")}`,
  );
  ok("scoped grep finds overview, path relative to Brain", /(^|\n)overview:\d+: .*Overview/.test(t1));
  ok("scoped grep does NOT prefix with Brain/", !/Brain\/overview:/.test(t1));

  // 2) Drive-level search -> path relative to the drive (Brain/overview).
  const r2 = await ops.grepSearch({ pattern: "# Overview", path: P("") });
  const t2 = r2.content[0].text;
  ok("drive-level grep yields drive-relative path", /Brain\/overview:\d+: /.test(t2), t2.split("\n")[0]);

  // 3) Case-insensitive search (depends on server regex engine supporting (?i)).
  const r3 = await ops.grepSearch({ pattern: "overview", path: P("Brain"), ignoreCase: true });
  const t3 = r3.content[0].text;
  ok(
    "ignoreCase matches '# Overview'",
    /overview:\d+: .*Overview/i.test(t3) && t3 !== "No matches found",
    JSON.stringify(t3.slice(0, 80)),
  );

  // 4) Literal search escapes regex metachars (search a literal that contains special chars).
  const r4 = await ops.grepSearch({ pattern: "(dual-mount", path: P(""), literal: true });
  ok(
    "literal search runs without regex error",
    Array.isArray(r4.content) && typeof r4.content[0].text === "string",
  );

  // 5) No-match returns the canonical message.
  const r5 = await ops.grepSearch({ pattern: `zzz_no_such_string_zzz_${Date.now()}`, path: P("") });
  ok("no-match -> 'No matches found'", r5.content[0].text === "No matches found");

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
