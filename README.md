# pagespace-cli

A PageSpace-native `pi` companion (a [pi](https://pi.dev) package).

- **Dual-mount files:** pi's `read`/`write`/`edit`/`ls`/`find`/`grep` operate on PageSpace pages
  under a `pagespace/<drive>/…` mount; everything else is the local repo; `bash` stays local.
- **PageSpace as the model brain:** pi's LLM calls go to PageSpace `POST /api/v1/chat/completions`
  (model `ps-agent://<pageId>`); a prompted-tool shim keeps the tool loop entirely in pi.

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

Check your setup (env report + a live auth ping):

```bash
pagespace status        # or: node bin/pagespace.mjs status
```

## Use

```bash
pi install -l .          # register this package with pi (or add the path to .pi/settings.json)
pagespace                # branded launcher: pi with the PageSpace extension preloaded
# …equivalently: pi -e ./extensions/pagespace.ts
```

## Layout

- `extensions/pagespace.ts` — the pi extension (dual-mount adapter + model provider)
- `src/` — helpers (config, PageSpace API client, path↔page resolver, ops, provider, tool-call parser)
- `skills/`, `prompts/` — pi runtime skills + AIDD workflow prompts
- `test/unit/` — fast, network-free unit tests (run in CI); `test/run-*.ts` — live integration tests

## Development

```bash
npm install              # deps + husky pre-commit hook
npm run typecheck        # tsc --noEmit
npm run lint             # biome (also: npm run format)
npm test                 # unit tests (no network)
npm run check            # typecheck + lint + unit tests (also the pre-commit gate)
npm run test:live        # live integration tests — needs PAGESPACE_AUTH_TOKEN + PAGESPACE_MODEL_PAGE
```

Contributions go through PRs to `main`; CI (`.github/workflows/ci.yml`) runs typecheck, lint, and
unit tests on every PR and must pass before merge. Conventional commits.

Status and plan tracked in PageSpace (drive `pagespace-cli`): see the **Brain** and **Epics** pages.
