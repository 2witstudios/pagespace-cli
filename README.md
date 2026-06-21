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
npm install
```

`npm install` resolves the vendored pi workspaces in this monorepo (`packages/pi-agent-core`, `packages/pi-ai`, `packages/pi-coding-agent`, `packages/pi-tui`). You do **not** need a global `@earendil-works/pi-coding-agent` install.

Create local config (recommended):

```bash
cp .env.example .env.local
# then edit .env.local and set at least PAGESPACE_AUTH_TOKEN
```

Launch either way:

```bash
npm link
pagespace

# or without linking
node bin/pagespace.mjs
```

Run the doctor:

```bash
pagespace status
```

## Commands

```bash
pagespace                    # start the harness
pagespace status             # env + connectivity doctor
pagespace sessions           # list conversations for PAGESPACE_MODEL_PAGE
pagespace resume <id>        # resume by exact id or unique prefix
```

In-session model switching:

- `/model`
- `Shift+Tab` (cycles configured/discovered PageSpace agents)

## Configuration

### Environment variables

By default, launcher/extension load `.env.local` then `.env` (shell env still wins). Configure with:

| Variable | Required | Purpose |
|---|---|---|
| `PAGESPACE_AUTH_TOKEN` | **Yes** | Scoped PageSpace token for API access. |
| `PAGESPACE_API_URL` | No | PageSpace base URL. Default: `https://pagespace.ai`. |
| `PAGESPACE_DRIVE` | No | Default drive slug used for mount + memory grounding order. |
| `PAGESPACE_MOUNT` | No | Mount prefix in your cwd. Default: `pagespace`. |
| `PAGESPACE_MODEL_PAGE` | No | Optional primary brain agent page id (pin first model). |
| `PAGESPACE_MODEL_PAGES` | No | Optional comma-separated additional agent page ids. |
| `PAGESPACE_READONLY` | No | Optional comma-separated mounted prefixes to protect from write/edit (e.g. `Specs,Epics`). |

### Auto-discovery first, pinning optional

If `PAGESPACE_MODEL_PAGES` is not set, the extension auto-discovers model agents across all accessible drives and registers them under provider `pagespace`.

Use `PAGESPACE_MODEL_PAGE` / `PAGESPACE_MODEL_PAGES` only when you want to pin or extend the model list explicitly.

### `.env.local` vs `.mcp.json`

These are separate configuration paths:

- **`.env.local` / `.env`**: consumed directly by `pagespace` launcher + extension runtime.
- **`.mcp.json`** (gitignored): MCP server config format (see `.mcp.json.example`) that can also hold the same token for MCP workflows.

`pagespace status` will suggest `.mcp.json.example` when required env is missing, but runtime behavior is still based on process env.

## How it works

### 1) Dual-mount files

`extensions/pagespace.ts` replaces file tools with path-aware routers:

- under mounted PageSpace path: operate on PageSpace pages via API
- outside mount: use local filesystem tools
- `grep` on mounted paths uses server-side regex search
- `bash` remains local-only

### 2) PageSpace as model brain

`src/provider.ts` registers provider `pagespace` and calls:

- `POST /api/v1/chat/completions`
- `model: ps-agent://<pageId>`
- includes pi-native `tools`
- `disable_server_tools: true`

The model streams native `tool_calls`; pi executes those tools locally and returns tool results in the next turn. No text tool shim.

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
