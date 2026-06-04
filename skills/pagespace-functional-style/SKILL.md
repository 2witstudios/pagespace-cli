---
name: pagespace-functional-style
description: Functional TypeScript style for the pagespace-cli src/ modules. Use when writing or editing harness modules — separate pure logic from side effects so the logic is unit-testable without I/O, keep modules dependency-light, and follow the established module shape (pure helpers + a thin live wrapper + a register*Tool).
---

# Functional style (AIDD)

The codebase's modules follow a consistent shape that keeps the testable logic pure.

## Separate pure logic from effects
- Put decisions/parsing/formatting in **pure functions** (no network, no fs, no time) — they get
  unit tests in `test/unit/`. Examples: `parseVerdict`/`computePass` (review), `parseRequirements`,
  `parseChurn`, `ToolCallParser`.
- Wrap the effect (a model call, a PageSpace write, a git/child-process run) in a **thin async
  function** that calls the pure helpers. Example: `review()` = `completeViaBrain()` then
  `parseVerdict()`; only the network is impure.

## Determinism dial
- **Enforcement is code** (gates, parsing, the pass/fail decision) — fail-safe and deterministic.
- **Judgment is a deterministically-invoked LLM step** (`src/brain.ts` `completeViaBrain`) whose
  output is validated/parsed in code. The model reasons; the harness decides.
- **Soft guidance is a discretionary skill** (like this file) — the model reads it when relevant.

## Module conventions
- Dependency-light: import types from `@earendil-works/pi-ai`/`pi-coding-agent`; avoid new deps.
- Reuse the shared primitives: `completeViaBrain` for LLM steps, `tryExtractFirstJsonObject`
  (`tool-call-parser.ts`) / `extractJsonArray` (`requirements.ts`) for parsing model JSON.
- Expose harness behavior as a `register<X>Tool(pi, …)` and wire it in `extensions/pagespace.ts`.
- Match the surrounding code's naming, comment density, and idiom.
