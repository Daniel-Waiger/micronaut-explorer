---
name: cma-run
description: micronaut-explorer's CMA multi-agent scheme — extends the user-level cma-run skill with this repo's dashboard, lessons file, and task-graph conventions.
---

# /cma-run — micronaut-explorer

**First: read `~/.claude/skills/cma-run/SKILL.md` and follow its
procedure.** That file owns the role/model assignment (Opus or Fable
orchestrates depending on availability/need, Sonnet executes, Opus verifies,
Haiku for quick/short-context ops), the master decision rule, warm-context-
first policy, verification gate, token-economy rules, and the
dashboard/lessons-file requirements. This file only adds what is specific to
this project. Do not restate the base procedure here.

That user-level base skill lives outside this repo (under the user's home
directory) and may simply be absent on CI or a fresh remote/sandboxed
session — if so, skip it and fall back to the conventions in this file plus
ordinary judgment; don't block on a missing file.

## This repo's dashboard

`tools/cma-dashboard/` — see its `README.md` for the full CLI. Use it on
**every** cma-run task here, per the base skill. The fast path:

```bash
cd tools/cma-dashboard
python update.py --new-run "<run name>" --orch "<model>" \
  --from-task-graph ../../docs/plans/<plan>-task-graph.json
```

then serve it with the `cma-dashboard` entry in `.claude/launch.json`
(port 8777) and drive it with `--task` / `--stat` / `--current` / `--log` as
tasks move. `status.json` is gitignored per-run state; `update.py` also
auto-rewrites the offline snapshot inside `index.html`, so **never hand-edit
that HTML to change what the board shows**.

A persistent published-artifact mirror also exists for cross-machine viewing
— see the `app-workflow-preference` memory for its URL, and always update
that SAME artifact URL on republish rather than minting a new one.

## This repo's lessons file

`docs/cma-lessons.md` — planner/executor/verifier MUST read this first. Keep
it readable in one pass; the cma-learner stage merges/dedupes rather than
appending.

## This repo's plan/task-graph convention

Plans live at `docs/plans/<name>.md` with a companion
`docs/plans/<name>-task-graph.json` holding the authoritative per-task
scope + verification text (read the JSON, not the prose `.md`, when driving
execution — the `.md` is lossy). See `ROADMAP.md` / `TASKS.md` for the
longer-range backlog these plans draw from.

Status vocabulary: `pending running verifying done resolved failed paused
idle`. `resolved` means "failed, then fixed" — never relabel a repaired
failure as plain `done`.

## Standing preferences this project has already set

- **Always** use this scheme and **always** show the dashboard for
  substantial multi-task work (user directive, 2026-07-26).
- Never push or open a PR without explicit confirmation, even mid-run.
- Classic-era invariants (bioio/tifffile/readlif environment requirements,
  the pixel-data-loading ban, the batch-rename 1:1 safety invariant) were
  retired along with the Classic app itself, archived at tag `classic-final`.
