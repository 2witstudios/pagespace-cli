# pagespace-cli

A PageSpace-native `pi` companion (a [pi](https://pi.dev) package).

- **Dual-mount files:** pi's `read`/`write`/`edit`/`ls`/`find`/`grep` operate on PageSpace pages
  under a `pagespace/<drive>/…` mount; everything else is the local repo; `bash` stays local.
- **PageSpace as the model brain:** pi's LLM calls go to PageSpace `POST /api/v1/chat/completions`
  (model `ps-agent://<pageId>`); a prompted-tool shim keeps the tool loop entirely in pi.

## Use (development)

```bash
export PAGESPACE_API_URL="https://pagespace.ai"
export PAGESPACE_AUTH_TOKEN="<your scoped MCP token>"
export PAGESPACE_DRIVE="pagespace-cli"

pi install -l .          # or add this path to .pi/settings.json
pi                       # /reload after edits
```

## Layout

- `extensions/pagespace.ts` — the pi extension (dual-mount adapter + model provider)
- `src/` — helpers (config, PageSpace API client, path↔page resolver, ops, provider)
- `skills/`, `prompts/` — pi runtime skills + AIDD workflow prompts

Status and plan tracked in PageSpace (drive `pagespace-cli`): see the **Brain** and **Tasks** pages.
