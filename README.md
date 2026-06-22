# pagespace-cli

**A PageSpace-native coding harness built on pi.**

`pagespace-cli` turns PageSpace into first-class runtime substrate for coding sessions: PageSpace pages are mounted into the agent filesystem, PageSpace AI agents are used as the model brain, and project memory/tasks are grounded from the drive. The key design goal is deterministic wiring in the harness (extension/hooks/gates), not “hope the model remembers to use the right tool.”

## Features

- **Dual-mount filesystem routing**
  - `read`/`write`/`edit`/`ls`/`find`/`grep` route by path.
  - Paths under `pagespace/<drive>/...` operate on PageSpace pages.
  - Local repo paths stay local; `bash` is always local.
- **PageSpace model brain via native function-calling**
  - Uses `POST /api/v1/chat/completions` with model `ps-agent://<pageId>`.
  - Sends pi tools as native `tools` and sets `disable_server_tools: true`.
  - Model returns native `tool_calls`; pi executes tools locally.
- **Model auto-discovery by default**
  - Discovers AI_CHAT agent pages across all drives visible to your token.
  - Prioritizes your default drive’s agents first.
  - Provider name is `pagespace`; switch agents with `/model` or `Shift+Tab`.
- **Deterministic memory/context hooks**
  - Injects standing drive context + relevant Brain notes.
  - Persists concise session entries to `Activity Log`.
  - Writes compaction summaries to durable memory pages.
- **AIDD modules implemented as harness tools**
  - Includes `requirements`, `review`, `fix`, `churn`, and `subagent` primitives.
- **Spec-gated build loop**
  - Includes `build` and `task_complete` tooling with gate + review flow.
- **Cross-machine session resume**
  - `pagespace sessions` + `pagespace resume <id>` for continuing synced conversations.
- **Isolated `pagespace` entrypoint**
  - Uses its own agent dir at `~/.pagespace/agent`.
  - Locks `allowedProviders` to `pagespace` for this launcher.
  - Registers skills from `skills/<name>/SKILL.md` as unprefixed `/<name>` commands.

## Quickstart

```bash
git clone https://github.com/2witstudios/pagespace-cli.git
cd pagespace-cli
npm install          # resolves vendored pi workspaces in packages/
npm run build        # required: builds workspace pi packages to dist/ (~3s)
```

This repo vendors pi via npm workspaces (`packages/`), so you do **not** need a global pi install.

Launch either way:

```bash
npm link             # optional: puts `pagespace` on your PATH
pagespace

# or without linking
node bin/pagespace.mjs
```

### First run (Cursor-grade onboarding)

If no token is configured, `pagespace` now runs an interactive onboarding flow instead of exiting:

- prompts you to paste a token
- validates auth (`GET /api/drives`)
- discovers accessible drives (preferred drive first)
- discovers available AI_CHAT agent models across drives
- defaults drive/model to the first discovered option
- writes credentials + selection, then launches

Materialized config on successful onboarding:

- `~/.pagespace/credentials` (token, mode `0600`)
- chosen default drive/model

Happy path is now: **install → run → onboard → code**.

## Commands

```bash
pagespace              # start (runs onboarding on first run if no token)
pagespace status       # config + auth doctor (credential store + structured ✓/✗)
pagespace login        # capture/refresh token into ~/.pagespace/credentials (0600)
pagespace sessions     # list synced conversations
pagespace resume <id>  # resume a conversation
```

In-session model switching:

- `/model`
- `Shift+Tab` (cycles configured/discovered PageSpace agents)

## Configuration

Token/config can come from three sources. Default UX is the credential store; override paths still work.

1. **Credential store (recommended):** `~/.pagespace/credentials` (mode `0600`). Written by first-run onboarding or `pagespace login`. Global across projects.
2. **Project env files (optional override):** `.env.local` then `.env`, auto-loaded by the launcher.
3. **Shell env (highest precedence):** exported env vars always win at runtime.

Effective precedence is: **shell env > `.env.local`/`.env` > credential store**.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PAGESPACE_AUTH_TOKEN` | No | Scoped token. **Now optional** (recommended to set via `pagespace login` / onboarding). |
| `PAGESPACE_API_URL` | No | PageSpace base URL. Default: `https://pagespace.ai`. |
| `PAGESPACE_DRIVE` | No | Default drive slug for bare mount paths. |
| `PAGESPACE_MOUNT` | No | Mount prefix in your cwd. Default: `pagespace`. |
| `PAGESPACE_MODEL_PAGE` | No | Optional primary model page pin. |
| `PAGESPACE_MODEL_PAGES` | No | Optional comma-separated model page pins. |
| `PAGESPACE_READONLY` | No | Optional comma-separated mounted prefixes to protect from write/edit (e.g. `Specs,Epics`). |

### Models: auto-discovery by default

If model pins are not set, `pagespace` auto-discovers AI_CHAT agent models across all drives accessible to your token (preferred drive first).

Use `PAGESPACE_MODEL_PAGE` / `PAGESPACE_MODEL_PAGES` only when you want explicit pinning.

### Security note

The launcher strips auth token env before spawning pi. That means the agent's `bash` tool cannot read your token via `env`, `printenv`, or `/proc/self/environ`. Provider auth reads from config/credential storage, not child process env.

## How it works

### 1) Dual-mount filesystem

- Paths under `pagespace/<drive>/...` route to PageSpace pages.
- Everything outside that mount stays on your local filesystem.
- `bash` always runs locally.

### 2) PageSpace brain

- Uses native function-calling via `POST /api/v1/chat/completions`.
- Targets `model: ps-agent://<pageId>`.
- Sends pi tools with `disable_server_tools: true`, keeping the tool loop in pi.

This keeps the two axes explicit: **PageSpace-backed mounted memory/files + local code execution**.

## Architecture (condensed)

The core composition lives in `extensions/pagespace.ts`: tool routing, provider registration, skill command registration, model switching shortcuts, deterministic memory hooks, and gated build/task tools.

`src/` contains focused modules for:

- PageSpace API + path resolution + mounted file ops
- Provider + brain call plumbing
- Context engine, retrieval, persistence, compaction
- AIDD/tooling primitives (`requirements`, `review`, `fix`, `churn`, `subagent`)
- Spec/gate/complete/build flow (`spec`, `gate`, `complete`, `build`, `rails`)

For deep design context and roadmap state, use the PageSpace drive `pagespace-cli` as source of truth (`Vision`, `Brain`, `Epics`, `Activity Log`).

## Development

```bash
npm run typecheck
npm run lint
npm run format
npm run test
npm run check
npm run test:live
npm run build
```

- **Unit tests**: `test/unit/*.test.ts` (fast, no network; used in CI)
- **Live tests**: `test/run-*.ts` (require real token/model config)

`npm run check` (typecheck + lint + unit tests) is the pre-commit gate via husky.

For contributor flow, see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Optional for pi-local development flows:

```bash
pi install -l .
```

(Useful when loading this package directly into a pi runtime during development.)

## Install & distribution

- Root package is `private: true` and not published.
- Exposed CLI bin: `pagespace` → `bin/pagespace.mjs`.
- Packaged files include `extensions`, `src`, `skills`, `prompts`, `bin`, `packages`, `README.md`.

Local distribution options:

```bash
npm link   # put pagespace on PATH locally
npm pack   # create a tarball
```

There is currently no `peerDependencies` section in the root `package.json`; this repo vendors required pi packages via npm workspaces.

## Status & pointers

Code in `src/` already includes memory/context, AIDD modules, and spec-gated build tooling. Roadmap tracking in the PageSpace Epics board may still show later epics as planned while implementation continues.

When in doubt, treat the PageSpace `pagespace-cli` drive as canonical:

- `Vision` (north star)
- `Brain` (architecture/grounding notes)
- `Epics` (task board)
- `Activity Log` (history)
