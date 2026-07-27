#!/usr/bin/env python3
"""Tiny mutator for the dashboard status.json.

Examples:
  python update.py --model "Claude Sonnet" --status running --current P0-1 "Add timeout" --task P0-1=running:Claude Sonnet --log "Dispatched P0-1"
  python update.py --status done --current-clear --task P0-1=done --log "P0-1 complete: 3 files, tests green"
"""
from __future__ import annotations
import argparse, json, sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
SP = HERE / "status.json"
SEED = HERE / "status.seed.json"

EMPTY_STATE = {
    "run": "CMA run",
    "orchestrator": "",
    "active_model": "Idle",
    "active_status": "idle",
    "phase": "",
    "state_note": "",
    "current_task": None,
    "crit_title": "Live data-safety defects — proven, unfixed",
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
    return dict(EMPTY_STATE)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run")
    ap.add_argument("--model")
    ap.add_argument("--orch")
    ap.add_argument("--status")            # running | verifying | done | resolved | failed | pending | paused | idle
    ap.add_argument("--phase")
    ap.add_argument("--state-note")
    ap.add_argument("--current", nargs=2, metavar=("ID", "TITLE"))
    ap.add_argument("--current-clear", action="store_true")
    ap.add_argument("--task", action="append", default=[],
                    help="ID=STATUS or ID=STATUS:BY (updates an existing task only)")
    ap.add_argument("--task-add", action="append", default=[],
                    help="ID=PHASE=TITLE=STATUS[:BY] (appends a new task; no-op if ID exists)")
    ap.add_argument("--defect-add", action="append", default=[],
                    help="ID=LOCATION=TITLE (repro/body added separately isn't supported via CLI; edit status.json directly for those)")
    ap.add_argument("--defect-clear", metavar="ID", help="remove a defect by id once its fix is verified")
    ap.add_argument("--stat", action="append", default=[],
                    help="KEY=VALUE[:tone] upserts a hero stat, e.g. 'Test suite=239 passed:ok'")
    ap.add_argument("--log", action="append", default=[])
    a = ap.parse_args()

    d = _load()
    for key in EMPTY_STATE:
        d.setdefault(key, EMPTY_STATE[key])

    if a.run:        d["run"] = a.run
    if a.model:      d["active_model"] = a.model
    if a.orch:       d["orchestrator"] = a.orch
    if a.status:     d["active_status"] = a.status
    if a.phase:      d["phase"] = a.phase
    if a.state_note: d["state_note"] = a.state_note
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
            if st: t["status"] = st
            if by: t["by"] = by

    for spec in a.task_add:
        tid, _, rest = spec.partition("=")
        if tid in tmap:
            continue
        phase, _, rest2 = rest.partition("=")
        title, _, statusby = rest2.partition("=")
        st, _, by = statusby.partition(":")
        d["tasks"].append({
            "id": tid, "phase": phase, "title": title,
            "status": st or "pending", "by": by,
        })

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
            if tone: s["tone"] = tone
        else:
            entry = {"k": k, "v": v}
            if tone: entry["tone"] = tone
            d["stats"].append(entry)
            smap[k] = entry

    now = datetime.now().strftime("%H:%M:%S")
    for msg in a.log:
        d.setdefault("log", []).append({"time": now, "msg": msg})

    SP.write_text(json.dumps(d, indent=2), encoding="utf-8")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
