# Roadmap

Last updated: 2026-07-23

The live, task-level execution plan is in [TASKS.md](TASKS.md). This file is the
high-level phase summary; TASKS.md breaks each phase into session-sized units with
acceptance criteria and dependencies.

## Status of the original roadmap

The earlier roadmap's Phase 2 (apply manifest/log, rollback, conflict strategies) is
**already implemented** in code (`manifest.py`, `service.recalculate_batch`,
`--conflict-strategy`, and the UI Rollback Manager). Phase 1's test items are partly
done: pure-logic tests exist and pass, but the reader-dependent tests hang, so the
reliability baseline is not actually met. The revised plan below reflects that.

## Phase 0 — Stop the hang and unbreak CI (highest priority)
`extract_metadata` can block indefinitely on files bioio/Bio-Formats cannot parse,
freezing the CLI, the Streamlit UI, and CI. Bound extraction with a process timeout
and a heuristic fallback; make the default CI run fast and green; add UI feedback.

## Phase 1 — Correctness & honesty
Remove config fields that are advertised but unused; assemble/validate/name from a
single field dict; make batch recursion explicit; add `--json` CLI output; stop
rewriting config on every UI rerun; preserve `.ome.tif`; fix notes casing.

## Phase 2 — Extraction quality (the core value)
Structured OME-XML / per-format extraction with real sample fixtures; an externalized
marker/fluorophore dictionary with word-boundary matching; per-field provenance so
low-confidence guesses are surfaced for review instead of silently landing in names.

## Phase 3 — Release & UX
Robust data-editor round-trip; exportable preview report (CSV/JSON); first-run
config/profile wizard; opt-in/flagged lab defaults; LICENSE, CHANGELOG, lint/format/
type gates, and versioning discipline.
