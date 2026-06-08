# pagespace-cli

**The PageSpace coding harness.**

pagespace-cli wires [PageSpace](https://pagespace.ai) as the substrate for an AI coding session —
filesystem, model brain, memory, and task board — using deterministic harness primitives so the
agent always has the right context, can't skip PageSpace, and produces verifiable outcomes. Built on
[pi](https://pi.dev) with PageSpace as the model brain and a dual-mount filesystem adapter.

## Quickstart

```bash
npm i -g @earendil-works/pi-coding-agent
cd path/to/pagespace-cli && npm install
export PAGESPACE_AUTH_TOKEN="<your scoped token>"
pagespace
```

> First run: `npm link` from inside the repo to put `pagespace` on your PATH, or use
> `node bin/pagespace.mjs` directly. After that, `pagespace` is all you need.

Check your setup (env report + a live auth ping):

```bash
pagespace status
```

## How it works

Two axes, always active — wired in **deterministically** (code that runs every turn, not
model-discretion tool calls):

- **Dual-mount filesystem.** `read`/`write`/`edit`/`ls`/`find`/`grep` route by path: anything
  under `pagespace/<drive>/…` operates on PageSpace pages; everything else is the local repo;
  `bash` stays local. PageSpace mounts in as the spec/knowledge/memory layer.
- **PageSpace as the model brain.** LLM calls go to PageSpace `POST /api/v1/chat/completions`
  (model `ps-agent://<pageId>`) using native function-calling — pi's tools run locally; the
  PageSpace route never sees tools, just the model output.

## Commands

```bash
pagespace                    # start a coding session
pagespace status             # config check + live auth ping
pagespace sessions           # list synced sessions
pagespace resume <id>        # continue a session from another machine
# inside a session: /model   # switch between configured agents/models
```

## Auth & config

Configure via environment variables. The simplest durable approach is a **`.env.local`** in the
repo root — the extension and the `pagespace` launcher load `.env.local` then `.env` automatically
(`src/env.ts`); real shell exports always win. `.env*` is gitignored, so your token stays out of git.

```bash
cat > .env.local <<'EOF'
PAGESPACE_API_URL=https://pagespace.ai
PAGESPACE_AUTH_TOKEN=mcp_your_scoped_token
PAGESPACE_DRIVE=pagespace-cli
PAGESPACE_MODEL_PAGE=your_primary_brain_agent_page_id
PAGESPACE_MODEL_PAGES=your_primary_brain_agent_page_id,your_alt_agent_page_id
EOF
```

| Var | Required | Purpose |
|-----|----------|---------|
| `PAGESPACE_AUTH_TOKEN` | **yes** | Scoped PageSpace MCP token (Bearer). |
| `PAGESPACE_API_URL` | no | Instance URL (default `https://pagespace.ai`). |
| `PAGESPACE_DRIVE` | no | Default drive slug for the mount + memory engine. |
| `PAGESPACE_MODEL_PAGE` | no | Primary brain agent page id — also used by session commands (`sessions`/`resume`). |
| `PAGESPACE_MODEL_PAGES` | no | Comma-separated brain agent ids to register multiple `pagespace/<id>` models for quick `/model` toggling. |
| `PAGESPACE_READONLY` | no | Comma-separated mount sub-paths the write/edit tools refuse (spec immutability), e.g. `Specs,Epics`. |

### Brain agent page

`PAGESPACE_MODEL_PAGE` (and optionally `PAGESPACE_MODEL_PAGES`) register one or more
`pagespace/<pageId>` models. Select between them with `/model` inside a session, or set a default
once in `~/.pi/agent/settings.json`:

```json
{ "defaultProvider": "pagespace", "defaultModel": "<your brain agent page id>" }
```

The models register when at least one of `PAGESPACE_MODEL_PAGE` or `PAGESPACE_MODEL_PAGES`
is set *and* the extension is loaded — set them in `.env.local` and launch via `pagespace`.

## Skills

The harness ships its own **PageSpace-AIDD** skill set under `skills/` (`pagespace-aidd-*` — a
rebranded, PageSpace-adapted fork of [AIDD](https://github.com/paralleldrive/aidd), plus
`pagespace-*` natives). The `pagespace` launcher is the **isolated entrypoint**: it starts pi with
`--no-skills` and loads *only* these vendored skills, so your user-global `~/.agents/skills` never
bleed in and there are no skill-name collisions.

## Cross-machine resume

Sessions sync through PageSpace so you can **start a conversation on one machine and finish it on
another**. As you work, the active session (its JSONL) is mirrored to a page under the Companion
Agent (`Sessions/` folder). On another machine:

```bash
pagespace sessions
pagespace resume <id>
```

`resume` pulls the session back into pi's local store and continues it natively via `pi --session`
(full fidelity — tool calls and all). Needs `PAGESPACE_MODEL_PAGE` set. Hand-off is sequential
(stop on A, resume on B); it's last-writer-wins, not live co-editing.

Sync is **append-only**: each turn uploads just the new session lines (cheap for long sessions),
with a full re-render on compaction/shutdown to refresh the readable transcript.

## Architecture

PageSpace is the substrate — filesystem, model/brain, memory, and task list — wired in
**deterministically** (code that runs every turn) rather than left to the model's discretion. One
extension (`extensions/pagespace.ts`) composes it all.

### Two axes
- **Dual-mount files.** `read`/`write`/`edit`/`ls`/`find`/`grep` are routed by path: anything
  under `pagespace/<drive>/…` operates on PageSpace pages (`src/ops.ts` over the REST client
  `src/api.ts` + a path↔page resolver `src/resolve.ts`); everything else is the local repo; `bash`
  stays local. `grep` under the mount uses the drive's server-side `regex_search`.
- **PageSpace brain.** LLM calls go to PageSpace `POST /api/v1/chat/completions`
  (model `ps-agent://<pageId>`) using **native function-calling** (`src/provider.ts`): the request
  sends pi's tools + `disable_server_tools` (the route's client-only mode), the model returns native
  `tool_calls`, and pi runs each tool locally — the whole tool loop stays in pi. (This replaced an
  earlier prompted-tool text shim once the route accepted client `tools`, PageSpace #1559.)

### Deterministic memory engine (Epic 2)
- **Context auto-load** (`before_agent_start`): injects the drive's `Vision` + `_index` + Brain index
  + Epics board into every session (`src/context-engine.ts`).
- **Per-turn retrieval**: keyword-searches the Brain for the turn's prompt and injects the top notes
  within a budget (`src/retrieval.ts`).
- **Auto-persist** (`agent_end`): appends a concise entry to the `Activity Log` (`src/persistence.ts`).
- **Compaction → durable memory** (`session_compact`): writes the summary to a durable `Sessions`
  page (`src/compaction.ts`).

### AIDD as harness modules (Epic 3)
Judgment steps run as **deterministically-invoked LLM steps** over `src/brain.ts`, with their output
validated in code: `requirements` (schema-validated Given/should), `review` (a gate verdict), `fix`
(diagnose + propose). Plus `churn` (git hotspots), a `subagent` fan-out primitive (spawns
`pagespace --mode json` children), and discretionary guidance **skills** under `skills/`.

### Spec-gated `/build` engine (Epic 4)
"Done" is enforced, not claimed. Each leaf's spec page carries `Given X, should Y` + runnable
`gate:` commands (`src/spec.ts`). The flow: pick the next unblocked leaf (dependency-aware via
`depends-on:`) → implement → **shell gate** (`src/gate.ts`) → **mandatory review** (`src/review.ts`)
→ gated completion (`src/complete.ts` flips status only when both pass — the agent has no raw
status-write tool, only `task_complete`/`build`). **Separation of duties**: specs are read-only to
the implementer (`PAGESPACE_READONLY`); only the gate-runner completes. **Rails** (`src/rails.ts`):
per-leaf attempt caps + a budget guard (escalate, never relax the spec). The `/build` loop driver is
`src/build.ts`.

### Registered tools
`read` · `write` · `edit` · `ls` · `find` · `grep` · `bash` (pi built-in) · `pagespace_status` ·
`subagent` · `churn` · `task_complete` · `build` — and, when a brain page is configured,
`requirements` · `review` · `fix`. Plus the `pagespace` model provider and the memory/persistence hooks.

The project's plan, knowledge, and task board live in the **PageSpace `pagespace-cli` drive** (see its
`Brain`, `Vision`, `Epics`, and `Activity Log` pages) — the source of truth a stateless agent grounds on.

## Layout

- `extensions/pagespace.ts` — the extension entry (dual-mount adapter + provider + memory hooks + AIDD/build tools)
- `src/` — modules (config, api, resolve, ops, tool-call-parser, provider; context-engine, retrieval,
  persistence, compaction; brain, requirements, review, fix, churn, subagent; spec, gate, complete,
  build, rails; cli)
- `bin/pagespace.mjs` — the launcher (+ `pagespace status` doctor)
- `skills/`, `prompts/` — harness skills + AIDD workflow prompts
- `test/unit/` — fast, network-free unit tests (run in CI); `test/run-*.ts` — live integration tests

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run check
npm run test:live
```

- `npm install` — deps + the husky pre-commit hook.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — biome; `npm run format` rewrites in place.
- `npm test` — unit tests, no network.
- `npm run check` — typecheck + lint + unit tests; this is also the pre-commit gate.
- `npm run test:live` — live integration tests; needs `PAGESPACE_AUTH_TOKEN` + `PAGESPACE_MODEL_PAGE`.

To load the extension during development without installing globally:

```bash
cd path/to/pagespace-cli
pi install -l .
pi
```

`pi install -l .` registers the extension/skills/prompts for the pi runtime from the current
directory. Run it **from inside the repo** — running it from the wrong folder registers the wrong path.

Contributions go through PRs to `main`; CI (`.github/workflows/ci.yml`) runs typecheck, lint, and
unit tests on every PR and must pass before merge. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Install & distribution

pagespace-cli is a pi package: after `pi install -l .`, the pi runtime discovers the extension,
skills, and prompts automatically.

```bash
npm link           # expose pagespace bin on your PATH
npm pack           # build a shareable tarball: pagespace-cli-VERSION.tgz
```

The package is `private` (not published to npm). To publish later (a human decision): set
`"private": false`, confirm `name`/`version`/`files`/`bin`, then `npm publish`. `files` already
ships `extensions`, `src`, `skills`, `prompts`, `bin`, and the README; the pi peer deps
(`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`) stay peer dependencies.

Status and plan tracked in PageSpace (drive `pagespace-cli`): see the **Brain** and **Epics** pages.
