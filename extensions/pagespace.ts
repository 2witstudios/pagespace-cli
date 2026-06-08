/**
 * pagespace-cli — dual-mount adapter (pi extension entry).
 *
 * Routes pi's own read/write/edit/ls/find/grep by path: anything under the PageSpace mount
 * (`<cwd>/<PAGESPACE_MOUNT>/…`, default `<cwd>/pagespace/…`) operates on PageSpace pages;
 * everything else uses pi's normal local-fs tools. `bash` is left untouched (always local).
 *
 * Status: the page-backed operations (src/ops.ts) are verified against the live drive
 * (test/run-ops.ts). This entry wires them into pi's tools; needs a pi load to verify end to end.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createLsTool,
  createFindTool,
  createGrepTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../src/config.ts";
import { loadDotenv } from "../src/env.ts";
import { PageSpaceApi } from "../src/api.ts";
import { PageSpaceResolver } from "../src/resolve.ts";
import { createPageSpaceOps } from "../src/ops.ts";
import { createContextEngine } from "../src/context-engine.ts";
import { formatRetrievedNotes, retrieveBrainNotes } from "../src/retrieval.ts";
import { appendToPage, extractEntryInput, formatSessionEntry } from "../src/persistence.ts";
import { persistCompactionSummary } from "../src/compaction.ts";
import { pushSession } from "../src/session-sync.ts";
import { MAX_SUBAGENT_DEPTH, currentDepth, registerSubagentTool } from "../src/subagent.ts";
import { registerRequirementsTool } from "../src/requirements.ts";
import { registerReviewTool } from "../src/review.ts";
import { registerFixTool } from "../src/fix.ts";
import { registerChurnTool } from "../src/churn.ts";
import { registerTaskCompleteTool } from "../src/complete.ts";
import { registerBuildTool } from "../src/build.ts";
import { registerPageSpaceProvider } from "../src/provider.ts";

export default function (pi: ExtensionAPI) {
  // Source PAGESPACE_* from a project .env/.env.local before reading config, so the brain provider
  // registers under plain `pi` without the user having to export vars in every shell (shell wins).
  loadDotenv(path.dirname(fileURLToPath(import.meta.url)));
  const config = loadConfig();
  const api = new PageSpaceApi(config);
  const resolver = new PageSpaceResolver(api);
  const cwd = process.cwd();
  const mountRoot = path.resolve(cwd, config.mountPrefix);
  const ops = createPageSpaceOps(api, resolver, {
    mountRoot,
    defaultDriveSlug: config.defaultDriveSlug,
    readOnlyPrefixes: config.readOnlyPrefixes,
  });

  const routes = (params: { path?: string }): boolean =>
    ops.isMountPath(path.resolve(cwd, params?.path ?? "."));

  // Replace each built-in (same name) with a router that delegates by path: PageSpace-backed
  // when the path is under the mount, pi's local-fs tool otherwise. Registered explicitly (not
  // in a loop) so each tool keeps its concrete param type.
  {
    const local = createReadTool(cwd);
    const page = createReadTool(cwd, { operations: ops.read });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createWriteTool(cwd);
    const page = createWriteTool(cwd, { operations: ops.write });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createEditTool(cwd);
    const page = createEditTool(cwd, { operations: ops.edit });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createLsTool(cwd);
    const page = createLsTool(cwd, { operations: ops.ls });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    const local = createFindTool(cwd);
    const page = createFindTool(cwd, { operations: ops.find });
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        return (routes(params) ? page : local).execute(id, params, signal, onUpdate);
      },
    });
  }
  {
    // pi's grep spawns ripgrep against the LOCAL fs, so it can't search PageSpace pages — for
    // mount paths we route to the drive's server-side regex_search (ops.grepSearch) instead.
    const local = createGrepTool(cwd);
    pi.registerTool({
      ...local,
      async execute(id, params, signal, onUpdate) {
        if (routes(params)) {
          return ops.grepSearch({ ...params, path: path.resolve(cwd, params?.path ?? ".") });
        }
        return local.execute(id, params, signal, onUpdate);
      },
    });
  }
  // bash: intentionally left as pi's built-in (always local).

  // Connectivity smoke tool.
  pi.registerTool({
    name: "pagespace_status",
    label: "PageSpace: status",
    description: "Show the PageSpace mount + the drives this scoped token can reach.",
    parameters: Type.Object({}),
    async execute() {
      const drives = await api.listDrives();
      const text = `mount: ${mountRoot}\napiUrl: ${config.apiUrl}\ndefaultDrive: ${config.defaultDriveSlug ?? "(none)"}\ndrives:\n${drives.map((d) => `  - ${d.name} (${d.slug}) [${d.id}]`).join("\n") || "  (none)"}`;
      return { content: [{ type: "text", text }], details: { drives, mountRoot } };
    },
  });

  // Model brain: register the PageSpace provider — a custom streamSimple over
  // /api/v1/chat/completions (model `ps-agent://<pageId>`) using native function-calling (client-only
  // mode: pi's tools + `disable_server_tools`), keeping pi's tool loop local (src/provider.ts).
  // Verified end-to-end (test/run-provider.ts). Needs a configured brain page id (PAGESPACE_MODEL_PAGE);
  // skip cleanly if unset so the file tools still load. Works with any function-calling-capable model.
  if (config.modelPageId) {
    const { providerName, modelId } = registerPageSpaceProvider(pi, config);
    void providerName;
    void modelId;
  }

  // Fan-out / sub-agent primitive (Epic 3): spawn parallel PageSpace-native pi children for
  // independent sub-tasks. Only registered above the max nesting depth so sub-agents can't recurse.
  if (currentDepth() < MAX_SUBAGENT_DEPTH) {
    registerSubagentTool(pi, {
      model: config.modelPageId ? `pagespace/${config.modelPageId}` : undefined,
    });
  }

  // Churn (Epic 3): file change-frequency hotspots from git history (a local analysis tool).
  registerChurnTool(pi, cwd);

  // Gated task_complete (Epic 4): the only path to completion — runs the leaf's gate(s) + (when work
  // + rubric are given) a mandatory review, flipping the PageSpace task to completed only when all
  // pass (no raw status write / no self-complete).
  registerTaskCompleteTool(pi, api, config, cwd);

  // /build loop (Epic 4): advance the spec-gated build by one leaf (pick → spec → gate+review → complete).
  registerBuildTool(pi, api, config, cwd);

  // AIDD requirements step (Epic 3): a deterministically-invokable LLM step that derives
  // schema-validated "Given X, should Y" acceptance criteria via the PageSpace brain.
  if (config.modelPageId) {
    registerRequirementsTool(pi, config);
    // Review-as-gate (Epic 3): judge WORK against a RUBRIC; a blocker fails the gate (code-decided).
    registerReviewTool(pi, config);
    // Fix step (Epic 3): diagnose a failure + propose a concrete minimal fix (the TDD-loop reasoning).
    registerFixTool(pi, config);
  }

  // Deterministic memory (Epic 2): on every turn, inject (1) the drive's standing context (Vision +
  // indexes + Epics board, fetched once and cached) and (2) the Brain notes most relevant to this
  // turn's prompt (regex_search + client-side ranking, within a budget). So a stateless agent always
  // grounds on current drive state and pulls relevant memory without the model having to choose to.
  if (config.defaultDriveSlug) {
    const driveSlug = config.defaultDriveSlug;
    const contextEngine = createContextEngine(api, resolver, driveSlug);

    // Cross-machine resume: mirror the local pi session JSONL to a page UNDER the Companion Agent, so a
    // session started here can be pulled + continued elsewhere (`pagespace resume <id>` → `pi --session`).
    // Keyed by the stable session id; best-effort, never breaks the session. Needs a configured agent page.
    const agentPageId = config.modelPageId;
    // Append-only on ordinary turns (cheap); `full` re-renders the readable transcript/header on
    // compaction + shutdown so the human-readable snapshot is current (the JSONL stays live either way).
    const syncSession = async (
      ctx: {
        sessionManager: { getSessionId(): string; getCwd(): string; getSessionFile(): string | undefined };
      },
      full = false,
    ): Promise<void> => {
      if (!agentPageId) return;
      try {
        const sm = ctx.sessionManager;
        await pushSession(api, resolver, driveSlug, agentPageId, sm.getSessionId(), {
          cwd: sm.getCwd(),
          file: sm.getSessionFile(),
          full,
        });
      } catch {
        // sync must never break the session
      }
    };

    pi.on("before_agent_start", async (event) => {
      let systemPrompt = event.systemPrompt;
      const standing = await contextEngine.get().catch(() => "");
      if (standing) systemPrompt += `\n\n${standing}`;
      const notes = await retrieveBrainNotes(api, resolver, driveSlug, event.prompt).catch(() => []);
      const relevant = formatRetrievedNotes(notes);
      if (relevant) systemPrompt += `\n\n${relevant}`;
      return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
    });

    // Auto-persist on lifecycle: when the agent finishes handling a request, append a concise entry
    // to the drive's Activity Log so progress is durably recorded without the model choosing to.
    pi.on("agent_end", async (event, ctx) => {
      try {
        const input = extractEntryInput((event.messages ?? []) as { role?: string; content?: unknown }[]);
        if (!input) return;
        const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
        await appendToPage(api, resolver, driveSlug, "Activity Log", formatSessionEntry(ts, input));
      } catch {
        // persistence must never break the session
      }
      await syncSession(ctx);
    });

    // Compaction -> durable memory: when pi compacts the context, route the summary to a durable
    // PageSpace page so the knowledge outlives the session.
    pi.on("session_compact", async (event, ctx) => {
      try {
        const entry = (event as { compactionEntry?: { summary?: string; tokensBefore?: number } })
          .compactionEntry;
        if (!entry?.summary) return;
        await persistCompactionSummary(api, resolver, driveSlug, {
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
        });
      } catch {
        // persistence must never break the session
      }
      await syncSession(ctx, true); // compaction changed the transcript shape — full re-render
    });

    pi.on("session_shutdown", async (_event, ctx) => {
      await syncSession(ctx, true); // final snapshot — full re-render
    });
  }
}
