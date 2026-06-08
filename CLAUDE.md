# pagespace-cli — the PageSpace coding harness

## ⭐ Vision (primary context — read this first)
**We are building a coding harness that is PageSpace-native** — PageSpace is the substrate (pi's
filesystem, model/brain, memory, and task list). Before anything else, `read_page` the **Vision**:
PageSpace page `eulvhetfqz8ll6566bwxexar` (drive `pagespace-cli`). It is the north star — core concept,
principles, direction — and the **primary per-project injection** (the context engine will inject it
first; until then, this instruction does).

The official PageSpace coding harness: deterministic AIDD primitives with PageSpace as the
filesystem, model brain, memory, and task board. Built as a pi package on top of
`@earendil-works/pi-coding-agent` (MIT). Active plan: `~/.claude/plans/so-we-ve-proven-the-cuddly-sunset.md`.

## What it is (two axes, one scoped MCP token)

1. **Files (dual-mount):** pi's own `read`/`write`/`edit`/`ls`/`find`/`grep` route by path —
   `pagespace/<drive>/…` → PageSpace pages (`/api/mcp/documents`), everything else → the local
   repo; `bash` stays local. PageSpace mounts in as the spec/knowledge/memory layer.
2. **Brain (model):** pi's LLM calls → PageSpace `POST /api/v1/chat/completions` (chat-only), model
   `ps-agent://<pageId>`. A custom `streamSimple` shim keeps the whole tool loop in pi (inject tool
   specs → parse tool-call blocks from the reply → pi executes), so PageSpace never sees tools.

## Layout

```
extensions/pagespace.ts   # pi extension entry (dual-mount adapter + provider register)
src/                      # helpers (config, api client, resolve, ops, provider) — not pi-loaded
skills/                   # self-contained PageSpace-AIDD skills (pagespace-aidd-*, pagespace-*).
                          #   The `pagespace` launcher loads ONLY these (--no-skills); pi never
                          #   pulls user-global ~/.agents skills. Rebranded fork of AIDD.
prompts/                  # pi prompt templates (AIDD workflow commands)
ai/, aidd-custom/, AGENTS.md   # upstream AIDD v2.8.0 scaffold (npx aidd) — vendor source for
                          #   skills/, NOT pi-loaded. Re-vendor from ai/skills/ + rebrand.
```

## State lives in PageSpace + this repo (use the `pagespace` MCP)

**The PageSpace `pagespace-cli` drive + this git repo ARE the project's state. Work statelessly:**
load context from the drive at the start of a task, write durable outputs back to it, and don't
rely on conversation memory. Drive `pagespace-cli` (`kv725pqqj5go7rcvp2mv8zb8`).

**Where things go** (read the drive's `_index` for the full rules; place by intent):
Knowledge → `Brain/` · Requirement → `Specs/` · Work item → `Epics/` · Code map → `Codebase/` ·
Decision → `Brain/decisions/` + `Activity Log` · History → `Activity Log` · Why → `Vision` ·
Active plan → `Plan` · Agents → `Agents/`.

Page map:
- **`_index`** `clhjx7xu5e4yhlvpfs3h7xea` — drive front door (IA + statelessness).
- **Brain** (filesystem index) `dw9jthqyaza6ga3b6m5nmpqw` — a *tree of small notes*
  (`overview`, `architecture/*`, `grounding/*`, `decisions`, `setup-status`, `drive-map`), NOT one
  big doc. Read the index, open only the note you need; add new durable knowledge as a focused
  child page and list it in the nearest index — keep notes small.
- **Epics/** `ya71x41o5jys5ks4o7ths4gn` — the task board: 5 epic TASK_LISTs (Local MVP / Memory &
  Curator / Branded CLI / Cloud orchestration / Hardening), each body holds `Given X, should Y`
  requirements; statuses To Do / In Progress / Blocked / Done — keep current. ·
  **Vision** `eulvhetfqz8ll6566bwxexar` · **Plan** `v8ru7gkaywqnl0dpiltn2ezu` ·
  **Activity Log** `rlh61u86xxh3ygtcl6dwskw6` (AIDD `/log`).
- **Specs/** `wr0uw2q2po3vrpw7rn8lb4ng` · **Codebase/** `lditf7um1de4vbymqs9yj7vj` (repo map).
- **Agents/** `du2tfkewyoorurnmstp273ql`:
  - **Companion Agent** `xi9jg89d1qf40km2l29043yy` — pi's model brain
    (`ps-agent://xi9jg89d1qf40km2l29043yy`, `pagespace`/`pro`); `PAGESPACE_MODEL_PAGE`.
  - **Curator** `edekppwg59nv3qi3es41p2bf` — librarian agent that keeps the drive indexed,
    content-invalidated, organized, and in sync (Tasks/Plan/Activity Log/Codebase/Brain). Invoke
    it (`ask_agent`) after meaningful changes so the drive's state stays coherent.

Use the `pagespace` MCP tools (`read_page`, `replace_lines`, `create_page`, `create_task`,
`update_task`, `get_assigned_tasks`, …) — PageSpace is the source of truth for memory + tasks, not
local notes. (Configured in `./.mcp.json`; approve the project MCP server if its tools aren't loaded.)

## Working method (AIDD + PageSpace)

Follow the AIDD workflow (`/discover`, `/task`, `/execute`, `/aidd-fix`, `/review`, `/commit`) and
the `aidd-*` skills. Plan/specs/tasks live as PageSpace pages, not local `tasks/*.md`. Code lives in
this repo. Verify with real runs before marking a task Done.

## Dev workflow — autonomous, gated (GitHub: `2witstudios/pagespace-cli`, public)

The repo is set up to run hands-off. **Never commit straight to `main`** (branch-protected, requires
the CI check via a PR). The loop, per task/epic:
1. `git checkout main && git pull` → branch `feat/<slug>` (or `fix/`, `chore/`, `refactor/`, `docs/`).
2. Implement in small steps. Add/extend **unit tests** in `test/unit/` for pure logic (no network).
3. `npm run check` (typecheck + biome lint + unit tests) — also the **husky pre-commit** gate. For
   PageSpace-touching changes, also `npm run test:live` (needs `PAGESPACE_AUTH_TOKEN` +
   `PAGESPACE_MODEL_PAGE`; live tests stay out of CI by design).
4. **Conventional commits** (`feat:`/`fix:`/`refactor:`/`build:`/`test:`/`docs:`/`chore:`).
5. `git push -u origin <branch>` → `gh pr create` → CI runs (`typecheck · lint · unit tests`).
   When green, `gh pr merge --merge --delete-branch`. CI must pass; no human review is required.
6. Update the PageSpace **Epics** board (`update_task` → done), **Activity Log**, and any **Brain**
   notes. Re-ground from the drive before the next item. Keep secrets out of git — `.mcp.json` is
   gitignored (token leaks were purged from history before going public).

Commands: `npm run typecheck` · `npm run lint` (`format`) · `npm test` (unit) · `npm run test:live`
· `npm run check`. CI config: `.github/workflows/ci.yml`. Pre-commit: `.husky/pre-commit`.

## Env

`PAGESPACE_API_URL` (default `https://pagespace.ai`), `PAGESPACE_AUTH_TOKEN` (scoped MCP token),
`PAGESPACE_DRIVE` (default drive slug for the mount), `PAGESPACE_MOUNT` (mount prefix, default
`pagespace`).

## Critical

- Don't bundle pi packages — they're `peerDependencies` (`@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-ai`, `typebox`).
- pi seam reference skill: `~/.agents/skills/pi-harness-dev/`. pi source: `~/production/pi`.
- Iterate: `pi install -l .` (or add the path to `.pi/settings.json`), then `/reload`.
