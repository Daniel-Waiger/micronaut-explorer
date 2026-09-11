# CMA Model Activity Monitor

Live status board for CMA (multi-agent) runs. **Project-agnostic by design** —
nothing in it knows what a task means, what a phase is called, or which repo it
is tracking. All of that comes from the data, so the same board serves every
run without being adapted to any of them.

`index.html` works two ways from the same file:

- **Local / live**, during a run: `python -m http.server 8777` from this
  directory, open `http://localhost:8777`. The page polls `./status.json`
  every 1.5s (pulsing dot, "updated Ns ago").
- **Offline**, with no server: opened straight off disk over `file://`, or
  published as an artifact. `fetch()` fails there, so the page falls back to a
  snapshot embedded in the file itself.

## On every PC you work on

**`git pull`, then double-click `tools/cma-dashboard/index.html`.** That's the
whole setup. No install, no Python, no server, no npm, no browser extension —
`index.html` is tracked in git and carries the run state baked inside it, so
it works on any machine with a browser and a clone of the repo.

The footer tells you which mode you're in, so you are never guessing whether
what you're looking at is current:

- `offline snapshot · captured <date time> · no server running` — the state as
  of the last `update.py` call that was committed.
- `live · updated Ns ago` — polling `status.json` (a server is running here).

For live updates *on the machine actually running the work*, serve the folder
(`python -m http.server 8777`, or the `cma-dashboard` entry in
`.claude/launch.json`) and use `http://localhost:8777`. Everywhere else, the
double-clicked file is the right tool.

Because the snapshot lives inside the tracked `index.html`, **commit it at run
checkpoints** (end of a batch, end of a run, handover) — that is what carries
the board to your other machines. Don't commit it on every task tick; that
just spams history, which is exactly why `status.json` is gitignored.

## The one rule: never hand-edit the embedded snapshot

`update.py` rewrites everything between the `/* CMA:EMBEDDED:BEGIN */` and
`/* CMA:EMBEDDED:END */` markers **on every single call**, straight from
`status.json`. That means the offline snapshot cannot drift from the live run.

This used to be a manual step, and it silently rotted: for weeks anyone opening
the file without a server saw a months-old run complete with long-fixed
"live defects". If you find yourself editing HTML to change what the board
shows, something is wrong — change the data instead.

## Files

- `index.html` — the page. Tracked. Edit this only to change the *design*.
- `update.py` — the only thing that should ever write dashboard state. Tracked.
- `status.seed.json` — tracked starter/example state. `update.py` bootstraps a
  missing `status.json` from this on a fresh clone.
- `status.json` — the live run state. **Gitignored** — it churns every task, so
  committing it would spam history.

## Starting a run

Seed the whole board from the run's task graph rather than typing tasks in by
hand. `--from-task-graph` reads `id`/`title` and derives each task's phase from
the graph's `batches` array (falling back to a per-task `phase`), so it works
across differently-shaped graphs:

```bash
python update.py --new-run "planner-web P1" --orch "Claude Opus" \
  --from-task-graph ../../docs/plans/planner-web-task-graph.json
```

`--new-run` resets *all* run state (tasks, defects, stats, log) so a new run
never inherits the last one's board.

`--from-task-graph` also carries two more fields onto each task, both purely
additive to the existing `id`/`phase`/`title`/`status`/`by`:

- `depends_on` — the task's `depends_on` array from the graph, filtered to
  ids that actually exist elsewhere in the same graph. A task with no
  `depends_on`, or one naming an id the graph doesn't have, just gets `[]`
  for that entry — never a crash.
- `batch` — the task's 1-based index into the graph's `batches` array (the
  same data `phase`'s "Batch N" label is derived from), or `null` when the
  graph has no `batches`. A batch entry may be a bare list of task ids or an
  object carrying them under `tasks`; both shapes are read.

Both are tolerant of graphs that don't carry them: a graph with no
`depends_on` anywhere yields tasks with empty edge lists, and a graph with no
`batches` yields `batch: null` for every task. Neither omission is an error.

## Dependency graph view

Below the task board, the page renders the same tasks as an inline-SVG DAG:
nodes are tasks, directed edges are `depends_on` (arrow pointing at the
dependent task), and nodes are laid out in columns so the graph reads
left-to-right along the dependency flow. Columns come from each task's
`batch` field when the run supplied one; if no task carries a `batch`, the
page computes a longest-path depth from `depends_on` itself. Nodes are
coloured by current status using the exact same colours as the task board's
pills (not a second palette), and — since colour is never the only signal on
this page — every node still carries its id, a truncated title, and its
status as plain text, with the full title available on hover via an SVG
`<title>`. No tasks, no edges, or a single-node graph all render without
error. Like the rest of the page, it redraws on every `render()` call, so it
updates live while a server is running and is baked into the offline
snapshot the same way everything else is.

## Driving a run

```bash
python update.py --model "Claude Sonnet" --status running \
  --current C1-1 "KB loader" --task C1-1=running:Sonnet \
  --log "Dispatched C1-1"

python update.py --task C1-1=done:"Opus verified" \
  --stat "JS tests=82 passed:ok" --log "C1-1 verified pass"

python update.py --defect-add D1=paths.js:39="Prototype pollution via __proto__"
python update.py --defect-clear D1 --log "D1 fixed and verified"
```

`--task` updates an existing task (and warns if the id isn't on the board);
`--task-add` appends a new one (no-op if the id already exists, so it's safe to
call every run). `--stat` upserts a hero stat. With no `--stat` at all the board
computes Orchestrator / Progress / Phase automatically.

Status vocabulary: `pending` `running` `verifying` `done` `resolved` `failed`
`paused` `idle` — `resolved` means *failed, then fixed*; never relabel a
repaired failure as `done`, that erases the run's real defect history.

See `docs/cma-lessons.md` for the wider CMA scheme this dashboard tracks, and
`.claude/skills/cma-run/` for when to use it.
