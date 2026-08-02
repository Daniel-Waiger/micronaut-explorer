---
name: handover
description: End-of-session carry-forward for micronaut-explorer. Extends the user-level handover with this project's CMA pipeline state, plan docs, and standing safety invariants.
---

# /handover — micronaut-explorer

**First: read `C:\Users\Owner\.claude\skills\handover\SKILL.md` and follow its procedure.**
That file owns the survey → filter → persist → ask-before-commit → print flow. This file
only adds what is specific to this project. Do not restate the base procedure here.

## Additional survey inputs (step 1)

- `tools/cma-dashboard/status.json` — live CMA task state. **Gitignored**, so `git status`
  will never reveal it. Its vocabulary: `pending running verifying done resolved failed
  paused idle`, where `resolved` means "failed, then fixed" — never relabel a repaired
  failure as `done`.
- The newest `docs/plans/*task-graph*.json` — the authoritative T-numbered task specs
  (scope + verification per task). Read a task's spec from here rather than from the
  prose `.md` sibling, which is lossy.
- `ROADMAP.md` and `TASKS.md` — the long-range planning docs.

## De-duplication rule (step 3)

**Do not copy pipeline-practice lessons into memory.** `docs/cma-lessons.md` owns those and
the CMA LEARN stage maintains it — how to size tasks, how to verify, what the pipeline got
wrong. Memory holds *project state*: what's unfinished, what was decided, what surprised us.

If a session produced a genuine pipeline lesson and no CMA run happened to capture it, say
so in **Open questions** ("worth adding to cma-lessons?") rather than writing it to memory.

## Project-specific watch-outs (step 5)

Surface these in the note when the session touched them:

- **Planning-doc drift.** `ROADMAP.md` / `TASKS.md` are updated by hand and go stale. When
  they contradict what actually shipped, flag it — a future session that trusts them will
  plan against a fiction.
- **Python environment.** Always `.venv/Scripts/python.exe`. The global/Anaconda Python
  lacks the bioio reader plugins, `tifffile`, and `readlif`, and fails in confusing ways.
- **Never load pixel data.** On real microscopy files, do not call `.data`,
  `.get_image_data`, or `.xarray_data` — these pull gigabytes. Metadata only.
- **The rename safety invariant.** `BatchResult.planned` must stay strictly 1:1 with real
  files: `apply_batch` does an unguarded `src.rename(dst)` in a loop, so two entries sharing
  one source path raise `FileNotFoundError` on the second iteration *and* skip
  `save_manifest`, leaving the first rename unrollbackable.
- **Test markers.** `integration` is deselected by default; `smoke` is not. Default-run
  green is not full coverage — name the marked run explicitly when it matters.
