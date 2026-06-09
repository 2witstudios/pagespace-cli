/**
 * pagespace-cli — harness extension entry.
 *
 * Wires PageSpace as the coding harness substrate: routes read/write/edit/ls/find/grep by
 * path (anything under `<cwd>/<PAGESPACE_MOUNT>/…` maps to PageSpace pages; everything else
 * uses the local filesystem); registers the PageSpace model brain; mounts deterministic memory
 * hooks; and loads the AIDD/build tool set. `bash` stays local.
 *
 * End-to-end verification requires a running pagespace session.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };
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
import { MAX_SUBAGENT_DEPTH, currentDepth, registerSubagentTool } from "../src/subagent.ts";
import { registerRequirementsTool } from "../src/requirements.ts";
import { registerReviewTool } from "../src/review.ts";
import { registerFixTool } from "../src/fix.ts";
import { registerChurnTool } from "../src/churn.ts";
import { registerTaskCompleteTool } from "../src/complete.ts";
import { registerBuildTool } from "../src/build.ts";
import { registerPageSpaceProvider } from "../src/provider.ts";

export default function (pi: ExtensionAPI) {
  // Override the process title that pi sets (process.title = "pi") so terminal apps like iTerm2
  // show "pagespace" instead of "pi" in the process-name portion of the title bar.
  process.title = "pagespace";
  // Source PAGESPACE_* from a project .env/.env.local before reading config, so the brain provider
  // registers under plain `pi` without the user having to export vars in every shell (shell wins).
  loadDotenv(path.dirname(fileURLToPath(import.meta.url)));
  const config = loadConfig();
  config.conversationId = globalThis.crypto.randomUUID();
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

  // Register vendored skills as extension commands so they're invoked as /name (not /skill:name).
  // Each command wraps the skill body in a <skill> block and sends it as a user message, exactly
  // matching what pi's _expandSkillCommand does for /skill:name — so the LLM experience is identical.
  const skillsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");
  interface SkillEntry {
    name: string;
    description: string;
    body: string;
    filePath: string;
    dir: string;
  }
  const loadedSkills: SkillEntry[] = [];
  try {
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(skillsRoot, entry.name, "SKILL.md");
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      let skillName = entry.name;
      let description = "";
      let body = raw;
      if (fmMatch) {
        const fm = fmMatch[1];
        body = fmMatch[2].trim();
        const nm = fm.match(/^name:\s*(.+)$/m);
        if (nm) skillName = nm[1].trim();
        const dm = fm.match(/^description:\s*(.+)$/m);
        if (dm) description = dm[1].trim();
      }
      if (!description) continue;
      loadedSkills.push({
        name: skillName,
        description,
        body,
        filePath,
        dir: path.join(skillsRoot, entry.name),
      });
      pi.registerCommand(skillName, {
        description,
        handler: async (args) => {
          const block = `<skill name="${skillName}" location="${filePath}">\nReferences are relative to ${path.join(skillsRoot, entry.name)}.\n\n${body}\n</skill>`;
          pi.sendUserMessage(args ? `${block}\n\n${args}` : block);
        },
      });
    }
  } catch {
    /* skills dir missing — safe to skip */
  }

  // Inject skills list into system prompt so the model knows /name commands exist.
  if (loadedSkills.length > 0) {
    const skillsSection = `\n\n## Available skills\n\nInvoke with /name to load specialized instructions into the current turn.\n\n${loadedSkills.map((s) => `- \`/${s.name}\` — ${s.description}`).join("\n")}`;
    pi.on("before_agent_start", (event) => {
      if (event.systemPrompt.includes("Available skills")) return undefined;
      return { systemPrompt: event.systemPrompt + skillsSection };
    });
  }

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
  // Verified end-to-end (test/run-provider.ts). Registers when at least one brain page id is configured
  // (PAGESPACE_MODEL_PAGE and/or PAGESPACE_MODEL_PAGES), enabling quick /model toggling between agents.
  // Skip cleanly if unset so the file tools still load. Works with any function-calling-capable model.
  const configuredModelIds = config.modelPageIds ?? [];
  if (configuredModelIds.length > 0) {
    const { providerName, modelIds } = registerPageSpaceProvider(pi, config);
    void providerName;
    void modelIds;
  }

  // Ctrl+Shift+A: cycle between configured PageSpace agents. Shift+Tab is reserved by pi
  // for thinking-level cycling (RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS) and cannot
  // be overridden by extensions — it silently skips the registration and pi fires thinking
  // cycle instead. Ctrl+Shift+A is unused in pi's built-in keybinding set.
  if (configuredModelIds.length > 1) {
    pi.registerShortcut("ctrl+shift+a", {
      description: "Cycle to next PageSpace agent",
      handler: (ctx) => {
        const currentId = ctx.model?.id;
        const idx = currentId !== undefined ? configuredModelIds.indexOf(currentId) : -1;
        const nextId = configuredModelIds[(idx + 1) % configuredModelIds.length];
        const nextModel = ctx.modelRegistry.find("pagespace", nextId);
        if (nextModel) pi.setModel(nextModel);
      },
    });
  }

  // Fan-out / sub-agent primitive (Epic 3): spawn parallel pagespace children for
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
  if (configuredModelIds.length > 0) {
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
    pi.on("agent_end", async (event) => {
      try {
        const input = extractEntryInput((event.messages ?? []) as { role?: string; content?: unknown }[]);
        if (!input) return;
        const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
        await appendToPage(api, resolver, driveSlug, "Activity Log", formatSessionEntry(ts, input));
      } catch {
        // persistence must never break the session
      }
    });

    // Compaction -> durable memory: when pi compacts the context, route the summary to a durable
    // PageSpace page so the knowledge outlives the session.
    pi.on("session_compact", async (event) => {
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
    });
  }

  // Override pi's TUI header and terminal window title when running interactively.
  // setTitle is deferred via setImmediate so it runs after pi's own updateTerminalTitle()
  // (which fires synchronously after the session_start handlers complete), preventing it
  // from overwriting our title with "π - sessionName - cwd".
  pi.on("session_start", async (_event, ctx) => {
    if ((ctx as any).mode !== "tui") return;
    setImmediate(() => {
      const sm = (ctx as any).sessionManager;
      const sessionName = sm?.getSessionName?.() as string | undefined;
      const cwdBase = path.basename((sm?.getCwd?.() as string | undefined) ?? cwd);
      (ctx as any).ui?.setTitle?.(
        sessionName ? `pagespace - ${sessionName} - ${cwdBase}` : `pagespace - ${cwdBase}`,
      );
    });
    (ctx as any).ui?.setHeader?.((_tui: unknown, theme: any) => ({
      render(_width: number): string[] {
        return [
          theme.bold(theme.fg("accent", "pagespace")) + theme.fg("dim", ` v${version}`),
          theme.fg("muted", "the PageSpace coding harness"),
        ];
      },
      invalidate() {},
    }));
  });
}
