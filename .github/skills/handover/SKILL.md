---
name: handover
description: End-of-session carry-forward for micronaut-explorer. Use when the user asks to wrap up, hand over, or summarize a session before ending it.
---

# /handover — micronaut-explorer

**First: read `~/.copilot/skills/handover/SKILL.md` and follow its
procedure.** That file owns the survey → filter → persist → ask-before-
commit → print flow. This file only adds what is specific to this project.
Do not restate the base procedure here.

## Additional survey inputs (step 1)

- `tools/cma-dashboard/status.json` — live CMA task state (gitignored, so
  `git status` never reveals it). Vocabulary: `pending running verifying done
  resolved failed paused idle`, where `resolved` means "failed, then fixed" —
  never relabel a repaired failure as `done`.
- The newest `docs/plans/*task-graph*.json` — authoritative T-numbered task
  specs (scope + verification per task). Prefer this over the prose `.md`
  sibling, which is lossy.
- `ROADMAP.md` and `TASKS.md` — long-range planning docs (hand-updated, can
  go stale — flag it if they contradict what actually shipped).

## 2. Filter

Keep only what matters for a future session to pick up cleanly: unfinished
work, decisions made, surprises encountered. Drop routine narration.

## 3. Persist

Use the memory tool:
- `/memories/repo/` for facts a future session in this repo needs (build
  commands, conventions, in-progress state).
- Do **not** copy pipeline-practice lessons (how to size tasks, how to
  verify, what the CMA pipeline got wrong) into memory — those belong in
  `docs/cma-lessons.md`, owned by the CMA LEARN stage. If a genuine pipeline
  lesson surfaced and no CMA run captured it, note it under "Open questions"
  instead ("worth adding to cma-lessons?").

## 4. Ask before committing

If there are uncommitted changes worth keeping, ask the user before staging
or committing anything — do not commit/push automatically as part of handover.

## 5. Print

Print a short end-of-session note covering: what was done, what's unfinished,
open questions, and next steps. Call out these repo-specific watch-outs when
the session touched them:
- **Planning-doc drift** — `ROADMAP.md` / `TASKS.md` vs. what actually shipped.
- **Python environment** — always use `.venv/Scripts/python.exe`; the
  global/Anaconda Python lacks the bioio reader plugins, `tifffile`, and
  `readlif`, and fails in confusing ways.
