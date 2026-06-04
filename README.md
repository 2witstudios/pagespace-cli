# pagespace-cli

A PageSpace-native `pi` companion (a [pi](https://pi.dev) package).

- **Dual-mount files:** pi's `read`/`write`/`edit`/`ls`/`find`/`grep` operate on PageSpace pages
  under a `pagespace/<drive>/…` mount; everything else is the local repo; `bash` stays local.
- **PageSpace as the model brain:** pi's LLM calls go to PageSpace `POST /api/v1/chat/completions`
  (model `ps-agent://<pageId>`); a prompted-tool shim keeps the tool loop entirely in pi.

## Quickstart

Run these **from inside the cloned repo**. `pi install -l .` registers your *current directory* with
pi — running it from the wrong folder (e.g. your home) registers the wrong path and breaks `pi`.

```bash
npm i -g @earendil-works/pi-coding-agent
cd path/to/pagespace-cli
npm install
export PAGESPACE_AUTH_TOKEN="<your scoped token>"
node bin/pagespace.mjs status
pi install -l .
pi
```

After `pi install -l .`, **plain `pi` loads PageSpace** (dual-mount files + the brain + the tools).
The optional branded `pagespace` command needs an extra `npm link` — see [Use](#use).

> Tip: paste commands one line at a time. zsh doesn't treat `#` as a comment by default, so pasting a
> trailing `# …` (or one with `( )`) will error.

## Auth & config

Configure via environment variables (or `.mcp.json` — copy `.mcp.json.example` and fill in your
token; the real `.mcp.json` is gitignored):

| Var | Required | Purpose |
|-----|----------|---------|
| `PAGESPACE_AUTH_TOKEN` | **yes** | Scoped PageSpace MCP token (Bearer). |
| `PAGESPACE_API_URL` | no | Instance URL (default `https://pagespace.ai`). |
| `PAGESPACE_DRIVE` | no | Default drive slug for the mount + memory engine. |
| `PAGESPACE_MODEL_PAGE` | no | Brain agent page id (`ps-agent://<id>`) — pi's model. |
| `PAGESPACE_READONLY` | no | Comma-separated mount sub-paths the write/edit tools refuse (spec immutability), e.g. `Specs,Epics`. |

Check your setup (env report + a live auth ping) — works without any install step:

```bash
node bin/pagespace.mjs status
```

After `npm link` (see [Use](#use)), `pagespace status` is equivalent.

## Use

After `pi install -l .` (run **from inside the repo**), **plain `pi` loads the PageSpace extension** —
that's all you need:

```bash
cd path/to/pagespace-cli
pi install -l .
pi
```

`pi install -l .` registers the extension/skills/prompts for pi; it does **not** put a `pagespace`
command on your PATH. To run pi with the extension without installing, use
`pi -e ./extensions/pagespace.ts` from inside the repo.

To get the optional **branded `pagespace` command** (and `pagespace status`), link the bin from inside
the repo:

```bash
npm link
pagespace
pagespace status
```

`pagespace` is then equivalent to `pi` with the extension preloaded; `pagespace status` prints the
config + a live auth ping. (`node bin/pagespace.mjs status` works without `npm link`.)

## Architecture

PageSpace is the substrate — pi's filesystem, model/brain, memory, and task list — wired in
**deterministically** (code that runs every turn) rather than left to the model's discretion. One pi
extension (`extensions/pagespace.ts`) composes it all.

### Two axes
- **Dual-mount files.** pi's `read`/`write`/`edit`/`ls`/`find`/`grep` are routed by path: anything
  under `pagespace/<drive>/…` operates on PageSpace pages (`src/ops.ts` over the REST client
  `src/api.ts` + a path↔page resolver `src/resolve.ts`); everything else is the local repo; `bash`
  stays local. `grep` under the mount uses the drive's server-side `regex_search`.
- **PageSpace brain.** pi's LLM calls go to PageSpace `POST /api/v1/chat/completions`
  (model `ps-agent://<pageId>`). The route ignores client `tools`, so a **prompted-tool shim**
  (`src/tool-call-parser.ts` + `src/provider.ts`) injects pi's tool manifest, parses the model's
  `<tool_call>`/bare-JSON back into pi tool calls, and aborts the stream — the whole tool loop stays
  in pi. Tuned to be reliable on the managed `glm-5` tier.

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
`pi --mode json` children), and discretionary guidance **skills** under `skills/`.

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

- `extensions/pagespace.ts` — the pi extension (dual-mount adapter + provider + memory hooks + AIDD/build tools)
- `src/` — modules (config, api, resolve, ops, tool-call-parser, provider; context-engine, retrieval,
  persistence, compaction; brain, requirements, review, fix, churn, subagent; spec, gate, complete,
  build, rails; cli)
- `bin/pagespace.mjs` — the branded launcher (+ `pagespace status` doctor)
- `skills/`, `prompts/` — pi runtime skills + AIDD workflow prompts
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

Contributions go through PRs to `main`; CI (`.github/workflows/ci.yml`) runs typecheck, lint, and
unit tests on every PR and must pass before merge. Conventional commits.

## Install & distribution

This is a pi package: `pi` discovers its extension/skills/prompts once registered.

```bash
pi install -l .
npm link
npm pack
```

- `pi install -l .` — register the local package with pi (dev).
- `npm link` — expose the `pagespace` bin on your PATH.
- `npm pack` — build a shareable tarball named `pagespace-cli-VERSION.tgz`.

The package is `private` (not published to npm). To publish later (a human decision): set
`"private": false`, confirm `name`/`version`/`files`/`bin`, then `npm publish`. `files` already
ships `extensions`, `src`, `skills`, `prompts`, `bin`, and the README; the pi peer deps
(`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`) stay peer dependencies.

Status and plan tracked in PageSpace (drive `pagespace-cli`): see the **Brain** and **Epics** pages.
