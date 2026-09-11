#!/usr/bin/env python3
"""Mutator for the CMA dashboard's status.json (and, automatically, the
snapshot embedded in index.html).

This is the ONLY thing that should ever write dashboard state. It is
deliberately project-agnostic: nothing here knows what a task means, what a
phase is called, or which project it is tracking -- that all comes from the
data you pass in, so the same dashboard serves every run without being
adapted to any of them.

Two writes happen on every call:
  1. status.json  -- polled live by index.html when a server is running.
  2. the /* CMA:EMBEDDED */ block inside index.html -- the fallback used when
     no status.json can be fetched (a published artifact, or the file opened
     straight off disk over file://).

Keeping (2) in sync automatically is the whole point: it used to be
hand-maintained and silently went stale, so anyone opening the file without a
server saw a months-old run.

Starting a run:
  python update.py --new-run "planner-web P1" --orch "Claude Opus" \
      --from-task-graph ../../docs/plans/planner-web-task-graph.json

Driving it:
  python update.py --model "Claude Sonnet" --status running \
      --current C1-1 "KB loader" --task C1-1=running:Sonnet \
      --log "Dispatched C1-1"
  python update.py --task C1-1=done:"Opus verified" --stat "Tests=82 passed:ok"
  python update.py --defect-add D1=paths.js:39="Prototype pollution"
  python update.py --defect-clear D1 --log "D1 fixed and verified"
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
SP = HERE / "status.json"
SEED = HERE / "status.seed.json"
INDEX = HERE / "index.html"

EMBED_BEGIN = "/* CMA:EMBEDDED:BEGIN */"
EMBED_END = "/* CMA:EMBEDDED:END */"

# Every key the dashboard renders. A missing key is filled from here rather
# than crashing the page, so a partially-populated run still displays.
EMPTY_STATE = {
    "run": "CMA run",
    "orchestrator": "",
    "active_model": "Idle",
    "active_status": "idle",
    "phase": "",
    "state_note": "",
    "current_task": None,
    "crit_title": "Open defects",
    "stats": [],
    "defects": [],
    "tasks": [],
    "log": [],
}


def _load() -> dict:
    """status.json is gitignored (per-run state); bootstrap it on a fresh
    clone from status.seed.json if present, else start empty. This is what
    lets the dashboard travel via git without every run polluting history."""
    if SP.exists():
        return json.loads(SP.read_text(encoding="utf-8"))
    if SEED.exists():
        return json.loads(SEED.read_text(encoding="utf-8"))
    return json.loads(json.dumps(EMPTY_STATE))


def _sync_html(state: dict) -> bool:
    """Rewrite index.html's embedded snapshot from `state`. Returns False if
    the markers are missing (an older or hand-mangled index.html) so the
    caller can warn rather than silently leaving a stale snapshot behind."""
    if not INDEX.exists():
        return False
    html = INDEX.read_text(encoding="utf-8")
    start = html.find(EMBED_BEGIN)
    end = html.find(EMBED_END)
    if start == -1 or end == -1 or end < start:
        return False

    # Stamp when the snapshot was taken. On another machine the page has no
    # way to tell how old the baked-in data is, and "is this current?" is
    # exactly the confusion a silently-stale snapshot caused before.
    stamped = dict(state)
    stamped["snapshot_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")

    payload = json.dumps(stamped, indent=2, ensure_ascii=False)
    # A literal "</script>" inside any string would close the <script> element
    # early and break the page; "<\/" is the same string to a JS parser.
    payload = payload.replace("</", "<\\/")

    block = f"{EMBED_BEGIN}\nconst EMBEDDED = {payload};\n{EMBED_END}"
    INDEX.write_text(html[:start] + block + html[end + len(EMBED_END) :], encoding="utf-8")
    return True


def _batch_maps_from_graph(graph: dict) -> tuple[dict[str, str], dict[str, int]]:
    """Map task id -> "Batch N" (for `phase`) and task id -> N (1-based,
    for layout) from a task graph's `batches` array, when it has one. Both
    maps are empty for a graph with no `batches`, which callers must treat
    as "no batch info" rather than an error."""
    phase_map: dict[str, str] = {}
    batch_map: dict[str, int] = {}
    for index, batch in enumerate(graph.get("batches") or [], start=1):
        # A batch entry is either a bare list of task ids or an object that
        # carries them under `tasks` -- both shapes occur in real task graphs,
        # and guessing wrong must not invent phantom ids or raise.
        ids = batch.get("tasks") if isinstance(batch, dict) else batch
        if not isinstance(ids, list):
            continue
        for task_id in ids:
            if not isinstance(task_id, str):
                continue
            phase_map[task_id] = f"Batch {index}"
            batch_map[task_id] = index
    return phase_map, batch_map


def _tasks_from_graph(path: Path) -> list[dict]:
    """Import tasks from a plan task-graph JSON.

    Reads only the fields every task graph in this scheme carries (id, title,
    and either a `batches` array or a per-task `phase`), plus -- when
    present -- each task's `depends_on` edges and its batch index, so it
    works across differently-shaped graphs without per-run adaptation --
    which is the entire reason this flag exists. A graph with no
    `depends_on`, no `batches`, or a `depends_on` entry naming an id this
    graph doesn't have is tolerated: those just yield no edges / no batch,
    never a crash.
    """
    graph = json.loads(path.read_text(encoding="utf-8"))
    raw_tasks = graph.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise SystemExit(f"{path}: no 'tasks' array found")

    phase_of, batch_of = _batch_maps_from_graph(graph)
    known_ids = {entry.get("id") for entry in raw_tasks if entry.get("id")}
    tasks = []
    for entry in raw_tasks:
        task_id = entry.get("id")
        if not task_id:
            continue
        depends_on = entry.get("depends_on")
        if not isinstance(depends_on, list):
            depends_on = []
        edges = [d for d in depends_on if isinstance(d, str) and d in known_ids]
        tasks.append(
            {
                "id": task_id,
                "phase": phase_of.get(task_id) or entry.get("phase") or "Tasks",
                "title": entry.get("title", ""),
                "status": "pending",
                "by": "queued",
                "depends_on": edges,
                "batch": batch_of.get(task_id),
            }
        )
    if not tasks:
        raise SystemExit(f"{path}: every entry in 'tasks' lacked an 'id'")
    return tasks


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--run")
    ap.add_argument(
        "--new-run",
        metavar="NAME",
        help="reset ALL run state (tasks, defects, stats, log) and start a fresh run",
    )
    ap.add_argument(
        "--from-task-graph",
        type=Path,
        metavar="PATH",
        help="seed the task board from a plan task-graph JSON (id/title/batch)",
    )
    ap.add_argument("--model")
    ap.add_argument("--orch")
    ap.add_argument(
        "--status"
    )  # running | verifying | done | resolved | failed | pending | paused | idle
    ap.add_argument("--phase")
    ap.add_argument("--state-note")
    ap.add_argument("--crit-title", help="heading for the defects band (default: 'Open defects')")
    ap.add_argument("--current", nargs=2, metavar=("ID", "TITLE"))
    ap.add_argument("--current-clear", action="store_true")
    ap.add_argument(
        "--task",
        action="append",
        default=[],
        help="ID=STATUS or ID=STATUS:BY (updates an existing task only)",
    )
    ap.add_argument(
        "--task-add",
        action="append",
        default=[],
        help="ID=PHASE=TITLE=STATUS[:BY] (appends a new task; no-op if ID exists)",
    )
    ap.add_argument(
        "--defect-add",
        action="append",
        default=[],
        help="ID=LOCATION=TITLE (repro/body: edit status.json directly, not supported here)",
    )
    ap.add_argument(
        "--defect-clear", metavar="ID", help="remove a defect by id once its fix is verified"
    )
    ap.add_argument(
        "--stat",
        action="append",
        default=[],
        help="KEY=VALUE[:tone] upserts a hero stat, e.g. 'Test suite=239 passed:ok'",
    )
    ap.add_argument("--log", action="append", default=[])
    a = ap.parse_args()

    if a.new_run:
        d = json.loads(json.dumps(EMPTY_STATE))
        d["run"] = a.new_run
    else:
        d = _load()
        for key in EMPTY_STATE:
            d.setdefault(key, EMPTY_STATE[key])

    if a.from_task_graph:
        d["tasks"] = _tasks_from_graph(a.from_task_graph)

    if a.run:
        d["run"] = a.run
    if a.model:
        d["active_model"] = a.model
    if a.orch:
        d["orchestrator"] = a.orch
    if a.status:
        d["active_status"] = a.status
    if a.phase:
        d["phase"] = a.phase
    if a.state_note:
        d["state_note"] = a.state_note
    if a.crit_title:
        d["crit_title"] = a.crit_title
    if a.current_clear:
        d["current_task"] = None
    if a.current:
        d["current_task"] = {"id": a.current[0], "title": a.current[1]}

    tmap = {t["id"]: t for t in d["tasks"]}
    for spec in a.task:
        tid, _, rest = spec.partition("=")
        st, _, by = rest.partition(":")
        t = tmap.get(tid)
        if t:
            if st:
                t["status"] = st
            if by:
                t["by"] = by
        else:
            print(f"warning: --task {tid}: no such task on the board", file=sys.stderr)

    for spec in a.task_add:
        tid, _, rest = spec.partition("=")
        if tid in tmap:
            continue
        phase, _, rest2 = rest.partition("=")
        title, _, statusby = rest2.partition("=")
        st, _, by = statusby.partition(":")
        entry = {
            "id": tid,
            "phase": phase,
            "title": title,
            "status": st or "pending",
            "by": by,
        }
        d["tasks"].append(entry)
        tmap[tid] = entry

    dmap = {f["id"]: f for f in d["defects"]}
    for spec in a.defect_add:
        did, _, rest = spec.partition("=")
        if did in dmap:
            continue
        loc, _, title = rest.partition("=")
        d["defects"].append({"id": did, "location": loc, "title": title, "body": "", "repro": ""})
    if a.defect_clear:
        d["defects"] = [f for f in d["defects"] if f["id"] != a.defect_clear]

    smap = {s["k"]: s for s in d["stats"]}
    for spec in a.stat:
        k, _, rest = spec.partition("=")
        v, _, tone = rest.partition(":")
        s = smap.get(k)
        if s:
            s["v"] = v
            if tone:
                s["tone"] = tone
        else:
            entry = {"k": k, "v": v}
            if tone:
                entry["tone"] = tone
            d["stats"].append(entry)
            smap[k] = entry

    now = datetime.now().strftime("%H:%M:%S")
    for msg in a.log:
        d.setdefault("log", []).append({"time": now, "msg": msg})

    SP.write_text(json.dumps(d, indent=2), encoding="utf-8")

    if _sync_html(d):
        print("ok (status.json + index.html snapshot)")
    else:
        print(
            f"ok (status.json only) -- warning: {INDEX.name} has no "
            f"{EMBED_BEGIN}/{EMBED_END} markers, so its offline snapshot is now stale",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
