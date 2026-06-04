---
name: pagespace-aidd-tdd
description: Test-driven development discipline for this project. Use when adding or changing behavior — express acceptance criteria as "Given X, should Y", write a failing test first (RED), implement the minimum to pass (GREEN), then refactor. Explains where unit vs live tests go and the gated PR flow.
---

# Test-driven development (AIDD)

Behavior changes are driven by tests, not the other way round.

## The loop
1. **Express the requirement** as `Given <situation>, should <observable behavior>`. Each is a single,
   testable, novel criterion — skip obvious boilerplate.
2. **RED** — write the failing test that encodes the requirement before the implementation.
3. **GREEN** — implement the minimum to make it pass without breaking others.
4. **Refactor** — clean up with the test as a safety net.

## Where tests go
- **`test/unit/*.test.ts`** — fast, network-free unit tests (Node's `node:test` via `tsx`). These run
  in CI and the husky pre-commit. Put pure logic here (parsers, formatters, decisions). Prefer
  extracting a pure function so its behavior is unit-testable without I/O.
- **`test/run-*.ts`** — live/integration tests that hit PageSpace or the brain or spawn processes.
  Local-only (need `PAGESPACE_AUTH_TOKEN`/`PAGESPACE_MODEL_PAGE`); not in CI.

## Gates (don't bypass them)
`npm run check` (typecheck + biome lint + unit tests) is the husky pre-commit gate and the CI gate.
Work lands via a branch → PR → green CI → merge. A change isn't done until the relevant test proves it
and the gate is green.
