# Plan — Resume A5 + C1 + C2 (CMA run)

Resumption of [safe-renaming-describer-openweights.md](safe-renaming-describer-openweights.md).
Raw task graph: [safe-renaming-resume-a5-c1-c2-task-graph.json](safe-renaming-resume-a5-c1-c2-task-graph.json)

## Why this exists

Yesterday's CMA run for the safe-renaming/describer/open-weights plan completed 6 of 9
tasks (A1, A2, A3, A4, B1, D1 — verified and committed as `9c9fa13`) before stopping.
A5, C1, C2 were fully scoped in the original plan doc but never executed. Rather than
re-plan (nothing about their scope has changed), this reuses the original Scope/
Verification text verbatim and resumes.

## Baseline (verified 2026-07-27 immediately before dispatch)

- `pytest -q -m "not integration"` = 217 passed
- `pytest -q -m integration` = 4 passed, 4 skipped (no vendor fixtures)
- ruff + black clean
- Working tree clean, branch `feat/safe-renaming-describer-openweights` at `9c9fa13`

## Tasks

| ID | Title | Depends on |
|----|-------|-----------|
| A5 | Date-provenance honesty (mtime vs acquisition) | — |
| C1 | Describer core: description → provisional fields | A5 (file-disjointness; formal dep is D1, already done) |
| C2 | Surface describer + provisional flags in UI/CLI | C1, A5 |

## Execution batches

Strictly sequential — A5, C1, and C2 all touch `service.py` alongside each other,
the same reasoning the original plan used to serialize A1→A2→A3→A5.

1. A5
2. C1
3. C2

## Dashboard state scheme (new today)

Task tiles now show one of five tags: **PENDING → RUNNING → VERIFYING → FAILED →
RESOLVED** (RESOLVED is annotated with a retry count when a retry was needed).
Collapsed from the previous 7-value vocabulary (pending/executing/verifying/
awaiting-verify/retrying/blocked/pass). Captured as lesson 32 in the global
`~/.claude/cma/lessons-core.md`. Watch live at http://localhost:47613.
