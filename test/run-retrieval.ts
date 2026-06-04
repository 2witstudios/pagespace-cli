/**
 * Live verification of per-turn Brain retrieval (Epic 2). Read-only.
 * Run: PAGESPACE_AUTH_TOKEN=... npx tsx test/run-retrieval.ts
 */
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { retrieveBrainNotes } from "../src/retrieval.ts";

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
  // A prompt about the model brain should surface the model-brain note(s).
  const notes = await retrieveBrainNotes(
    api,
    resolver,
    drive,
    "How does the model brain prompted tool protocol parse tool calls?",
  );
  console.log(`  retrieved: ${notes.map((n) => `${n.source}(${n.score})`).join(", ") || "(none)"}`);
  ok("retrieved at least one note", notes.length > 0);
  ok(
    "all retrieved are Brain notes",
    notes.every((n) => n.source.includes("Brain/")),
  );
  ok(
    "a model-brain note ranks in",
    notes.some((n) => /model-brain/.test(n.source)),
  );
  ok(
    "scores are positive and sorted desc",
    notes.every((n) => n.score > 0) && notes.every((n, i) => i === 0 || notes[i - 1].score >= n.score),
  );

  // An off-topic prompt with no Brain keywords should retrieve nothing (no noise).
  const none = await retrieveBrainNotes(api, resolver, drive, "ok do it now");
  ok("contentless prompt retrieves nothing", none.length === 0);

  // A grep-related prompt should surface the server-grep note.
  const grepNotes = await retrieveBrainNotes(
    api,
    resolver,
    drive,
    "how does server-side grep regex_search postgres work",
  );
  console.log(`  grep query: ${grepNotes.map((n) => n.source).join(", ") || "(none)"}`);
  ok(
    "grep query surfaces server-grep note",
    grepNotes.some((n) => /server-grep/.test(n.source)),
  );

  console.log(`\n${pass}/${total} assertions passed`);
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
