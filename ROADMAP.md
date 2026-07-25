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

## Future directions (not scheduled)

Larger bets captured for later — not committed work.

### Friendlier naming (near-term candidate)
Format masks instead of regex (`E##`, `X#+`), an example under every field, and a
"plan the name before you acquire" mode that previews the exact filename and exports
a naming guide or a reusable profile.

### Free-text experiment description → structured metadata (near-term candidate)
For image data with no embedded metadata, add an "experiment description" field where
the user describes what they did in plain language. The chosen LLM formulates that free
text into structured naming fields and injects them into a new editable metadata table
for the user to review, correct, and extend — turning "I know what I did" into a
conforming filename with no file metadata required.

### Web app re-platform (under discussion)
Deliver naming as a static website: naming rules/masks, the planner, and OME-TIFF
metadata read client-side in the browser (no upload, no install); vendor formats
(CZI/LIF/ND2) read locally via bioio through a run-without-install command
(`uvx mna …`), with the UI explaining why a local step is needed. Open decisions:
web language (TypeScript-native vs Pyodide), and whether to allow any upload fallback.

### Microscopy experimental-design assistant (vision)
Grow beyond naming into a broader experimental-design suite that advises on the
"why", not just the "what":
- Recommend the required experimental groups and controls for a given design, with
  the rationale for each.
- Help plan a fluorophore/color panel to minimize spectral spillover.
- Modality-specific guidance (e.g. STED, confocal, widefield): probe/dye selection,
  acquisition settings, and common pitfalls.
- Broadly: encode microscopy-core expertise so users design sound experiments before
  they acquire data.
