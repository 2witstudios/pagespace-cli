# Vision — pagespace-cli

Make `pi` (the minimal, extensible coding harness) a **native companion to PageSpace** rather than a
generic agent that talks to PageSpace as a foreign tool server.

- PageSpace pages become part of pi's **filesystem** (dual-mount), so pi's own read/write/edit work
  on PageSpace content while code + execution stay on a real local FS.
- PageSpace's own AI becomes pi's **model brain** (chat completions), with the entire tool loop kept
  inside pi.
- The AIDD methodology drives the work; specs/plans/tasks/knowledge live as PageSpace pages.

Shipped first as a pi package; later a branded `pagespace` CLI, then cloud/container orchestration.

> Source of truth / living memory: the **Brain** page in the `pagespace-cli` PageSpace drive
> (id `dw9jthqyaza6ga3b6m5nmpqw`). This file is a thin pointer for AIDD; keep the real detail there.
