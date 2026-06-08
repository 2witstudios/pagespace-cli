---
name: review
description: Review completed work against its spec or rubric. Use when the user asks to review, check, or validate completed code, a feature, or an epic.
---

Review the work described by the user. If a spec or rubric exists, judge every acceptance criterion explicitly (pass / fail / partial). If no spec exists, derive the implied requirements from the code and task context.

Structure your output:

## Review

**Verdict**: PASS | FAIL | NEEDS WORK

For each criterion or area:
- **[criterion]**: pass ✓ / fail ✗ / partial ~ — one-line finding

## Findings

List any failures or gaps with concrete file:line references and the minimum change needed to fix each.

## Summary

One paragraph: what passed, what failed, what to do next.

Be direct. A partial pass is a fail if the criterion is a gate. Don't soften blockers.
