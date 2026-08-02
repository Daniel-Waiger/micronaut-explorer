---
name: cma-run
description: micronaut-explorer's CMA multi-agent task-graph workflow — dashboard, lessons file, and task-graph conventions. Use when running or resuming a CMA (plan/execute/verify/learn) pass in this repo.
---

# /cma-run — micronaut-explorer

**First: read `~/.copilot/skills/cma-run/SKILL.md` and follow its
procedure.** That file owns the master decision rule, roles, warm-context-
first policy, and verification gate. This file only adds what is specific
to this project. Do not restate the base procedure here.

## This repo's dashboard

`tools/cma-dashboard/` — see its `README.md` for the full CLI. Use it on
**every** cma-run task here. Fast path:

```bash
cd tools/cma-dashboard
python update.py --new-run "<run name>" --orch "<model>" \
  --from-task-graph ../../docs/plans/<plan>-task-graph.json
```

`status.json` is gitignored per-run state; `update.py` also auto-rewrites
the offline snapshot inside `index.html` — **never hand-edit that HTML** to
change what the board shows.

A persistent published-artifact mirror also exists for cross-machine viewing
— check repo memory for its URL, and always update that SAME artifact URL on
republish rather than minting a new one.

## This repo's lessons file

`docs/cma-lessons.md` — read this first before planning, executing, or
verifying a task. Keep it readable in one pass; the learn stage merges/dedupes
entries rather than appending indefinitely.

## Task-graph conventions

- Task specs live in the newest `docs/plans/*task-graph.json` — treat this as
  authoritative over any prose `.md` sibling.
- Status vocabulary: `pending running verifying done resolved failed paused
  idle`. `resolved` means "failed, then fixed" — never relabel a repaired
  failure as plain `done`.
