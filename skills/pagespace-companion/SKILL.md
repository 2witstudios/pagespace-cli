---
name: pagespace-companion
description: Orientation for the PageSpace-native pi companion. Use when working in a repo where PageSpace is mounted under `pagespace/<drive>/…`. Explains that code lives in the local repo (edit + bash + tests as normal) while specs, plans, tasks, and knowledge live as PageSpace pages under the mount — read/write them like normal files.
---

# PageSpace companion

You are running with PageSpace mounted into your filesystem.

- **Code = the local repo.** Edit source files and run `bash` (tests, builds, git) normally — these
  are real local files.
- **Specs / plans / tasks / knowledge = PageSpace pages** under `pagespace/<drive>/…`. Read and write
  them with your normal `read`/`write`/`edit` tools — paths under the mount transparently map to
  PageSpace pages; everything else is local.

## How to work

1. Read the relevant `pagespace/<drive>/…` pages (plan, spec, tasks, brain) for context before coding.
2. Make code changes in the local repo; verify with `bash` (tests/build) before claiming done.
3. Record durable decisions/progress back to the PageSpace pages (brain, activity log) and keep the
   task list current.

Treat PageSpace as your shared memory and the team's source of truth; treat the repo as where code
actually runs.
