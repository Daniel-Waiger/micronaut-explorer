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

### Multi-image containers: LIF / ND2 / CZI (near-term correctness item)
LIF (series), ND2 (multipoint), and CZI (scenes) pack multiple images with differing
per-image metadata into one file. The extractor currently reads only the default scene
once, so a multi-series file is silently named off whichever scene bioio returns first —
confidently-wrong, not just incomplete. Fix, tied to P2-2 structured extraction (both
touch how `_extract_bioio_fields` reads these formats):
- Detect scene/series count (bioio exposes per-scene access); only special-case when > 1.
- Rename the CONTAINER file (do not split — this is a namer, not a converter). Put only
  fields shared across all internal images in the name; omit per-image-varying fields
  (per-series markers, stage positions) rather than guessing.
- Emit a sidecar (CSV/JSON) mapping each internal image (series index + internal name) to
  its canonical name, so per-image detail is preserved with zero bytes rewritten.
- Semantics differ: LIF series are often different setups (may want per-series identity);
  CZI scenes / ND2 points are usually one experiment at different positions (share identity,
  differ by a position index). Treat the varying axis as a suffix/sidecar, never a guess.
- Optional, clearly-destructive future converter: opt-in "export each series to its own
  canonically-named file" — separate from the default rename.

### Safe renaming (hardening cluster)
A rename is a destructive graph operation; the tool must not break links or destroy identity:
- Rename companion/sidecar files together (and never break a multi-file OME-TIFF set, whose
  planes reference each other by filename); warn when companions are detected.
- Always preserve the original filename (sidecar and/or embedded) so identity is recoverable
  even if the rollback manifest is lost or the files are moved.
- Mark LLM-suggested fields as provisional through to the final name (not just in-app), so a
  guess never reads as ground truth once applied.
- Warn before renaming files that are cloud-synced (e.g. Google Drive), locked/open, or
  externally referenced; make batch apply transactional (all-or-nothing) or clearly resumable,
  since a half-completed batch looks done.
- Treat raw acquisition data as potentially immutable (data-integrity / ALCOA posture): offer a
  "plan/sidecar only, don't mutate raw" mode; distinguish raw from working copies.
- Filesystem edges: Windows MAX_PATH, case-insensitive collisions, reserved names.
- Validation is a format check, not a truth check — never present "valid" as "correct"; make it
  explicit that an empty allow-list validates nothing for that field.
- Collisions hide real distinctions: prefer a unique/time component over a bare `_NN` suffix so
  two different acquisitions never become indistinguishable.
- Date provenance: `date` may come from file mtime (often the copy date, not acquisition) —
  surface which, don't silently trust mtime.

### LLM as enhancer, not originator (guardrails)
Naming is deterministic-first: parse metadata + keywords to build a solid base name; the LLM only
refines/formats it, grounded in the extracted metadata and the user's own input, and must never
invent biological identity (markers, experiment type, sample) from weak cues. First-line coded
guardrails live in `llm.py`'s prompt (do not fabricate; omit over guess; don't overwrite known
values; treat a user-provided description as authoritative context). Deeper enforcement — validate
LLM output against the available evidence, and keep suggestions reproducible (pin model/seed) — is
a follow-on.

### Free-text experiment description → structured metadata (near-term candidate)
For image data with no embedded metadata, add an "experiment description" field where
the user describes what they did in plain language. The chosen LLM formulates that free
text into structured naming fields and injects them into a new editable metadata table
for the user to review, correct, and extend — turning "I know what I did" into a
conforming filename with no file metadata required.

### Open-weights model support (near-term candidate)
Add support for local and open-weights models such as Qwen 3.5 and Gemma 30, allowing users to run the metadata enhancer and experiment describer without relying on closed-source APIs or sending data externally.

### Web app re-platform — APPROVED and IN PROGRESS (2026-07-29)
Superseded the file-picker/local-bioio idea below: a bigger pivot is underway,
codenamed **planner-web**. Rather than extracting naming fields out of microscopy
files after acquisition, the web app is a static, zero-install **experiment
planner** that walks design intent → panel/controls/acquisition → naming as a
downstream artifact of a finished design, deleting metadata extraction from the
web product entirely (that pipeline stays fragile and was the only reason the app
needed bioio/JVM/dask/Streamlit at all). Vanilla ES modules, flattened at build to
one self-contained HTML file (`tools/build_single_file.py`) that runs from `file://`
or GitHub Pages with identical bytes; zero npm dependencies (`node --test`);
renaming itself stays out of the web app (Micronaut Classic, `src/`, keeps that job
and is frozen going forward except bug fixes). See
[docs/plans/planner-web.md](docs/plans/planner-web.md) for the full plan and
[docs/plans/planner-web-task-graph.json](docs/plans/planner-web-task-graph.json)
for the authoritative per-task spec. P0 (schema, naming/validation ports, the
inliner, store+provenance, app shell, persistence, and a working name-builder
vertical slice) is done as of this writing. Next: P1 (interview engine +
deterministic free-text parsing).

<details>
<summary>Original idea (superseded, kept for history)</summary>

Deliver naming as a static website: naming rules/masks, the planner, and OME-TIFF
metadata read client-side in the browser (no upload, no install); vendor formats
(CZI/LIF/ND2) read locally via bioio through a run-without-install command
(`uvx mna …`), with the UI explaining why a local step is needed. Open decisions:
web language (TypeScript-native vs Pyodide), and whether to allow any upload fallback.
</details>

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
