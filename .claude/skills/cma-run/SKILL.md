---
name: cma-run
description: microscopy-naming-assistant's CMA multi-agent scheme — extends the user-level cma-run skill with this repo's dashboard, lessons file, and task-graph conventions.
---

# /cma-run — microscopy-naming-assistant

**First: read `C:\Users\dwaig\.claude\skills\cma-run\SKILL.md` and follow its
procedure.** That file owns the role/model assignment (Opus or Fable
orchestrates depending on availability/need, Sonnet executes, Opus verifies,
Haiku for quick/short-context ops), the token-economy rules, and the
dashboard/lessons-file requirements. This file only adds what is specific to
this project. Do not restate the base procedure here.

## This repo's dashboard

`tools/cma-dashboard/` — see its `README.md`. `status.json` is gitignored
(per-run state); `update.py` mutates it; serve with
`python -m http.server 8777` from that directory for a live local view.
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

## Standing preferences this project has already set

- **Always** use this scheme and **always** show the dashboard for
  substantial multi-task work (user directive, 2026-07-26).
- Never push or open a PR without explicit confirmation, even mid-run.
- Python: always `.venv/Scripts/python.exe` for anything touching bioio
  readers — the global/Anaconda Python fails in confusing ways.
