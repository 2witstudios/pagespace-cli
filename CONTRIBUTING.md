# Contributing to pagespace-cli

## Setup

```bash
git clone https://github.com/2witstudios/pagespace-cli.git
cd pagespace-cli
npm install
npm run check   # typecheck + lint + unit tests — must pass before you start
```

## Branch & PR

- `main` is branch-protected — no direct pushes
- Branch off `main`: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`
- Open a PR; CI runs typecheck + lint + unit tests automatically
- CI must be green before merge — no human review required

## Commit style

[Conventional commits](https://www.conventionalcommits.org):
`feat:` · `fix:` · `refactor:` · `build:` · `test:` · `docs:` · `chore:`

## Tests

- Unit tests live in `test/unit/` — fast, no network, run in CI
- Live integration tests in `test/run-*.ts` — need `PAGESPACE_AUTH_TOKEN` + `PAGESPACE_MODEL_PAGE`
- `npm run check` is the pre-commit gate (husky); fix anything it catches before pushing

## Where things go

- **Code** → this repo (`src/`, `extensions/`, `bin/`, `skills/`)
- **Specs, tasks, plan** → PageSpace drive `pagespace-cli` (see `Brain` and `Epics` pages)
- **Dev docs** → `CLAUDE.md` (agent-facing) or `README.md` (user-facing)

See `README.md` for architecture and `CLAUDE.md` for the full development workflow.
