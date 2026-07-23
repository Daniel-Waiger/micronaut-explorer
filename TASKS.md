# Execution Plan — Review Remediation

Last updated: 2026-07-23

This is the task-level execution plan derived from the code review. Tasks are sized
for a single focused session (Sonnet-executable): each touches a small number of
files, states exactly what "done" means, and lists its dependencies. Work phases in
order; within a phase, respect `Depends on`.

Supersedes the phase list in [ROADMAP.md](ROADMAP.md) (which describes work already
completed and does not address the hang).

## Conventions

- **Files** — the files the task should touch. Don't expand scope beyond these.
- **Done when** — acceptance criteria. Prefer a new/updated test that proves it.
- **Depends on** — must be merged first.
- **Needs input** — blocked on the user (sample files or a decision). Flagged ⚠.
- Every task must keep the fast test suite green: `pytest -q -m "not integration"`.
- Never commit large binaries; do not touch `build/`, `dist/`, or `*.zip`.

## Dependency overview

```
P0-1 ─┐
P0-2 ─┼─► P0-3 ─► P0-4 ─► P0-5, P0-6
      │
P1-1  │  (independent)
P1-2a ─► P1-2b ─► P1-2c ─────────────► P2-3a ─► P2-3b
P1-3a ─► P1-3b, P1-3c
P1-4a, P1-4b, P1-5, P1-6, P1-7  (independent)
P2-1a ─► P2-1b
P2-2a (⚠ fixtures) ─► P2-2b/c/d (⚠ fixtures)
P3-* (after P1/P2 land)
```

---

## Phase 0 — Stop the hang and unbreak CI (do first)

The root problem: `extract_metadata` calls `BioImage()`, which drops into the
Bio-Formats/Java path and never returns on files it cannot parse (confirmed: >40s on a
dummy `.tif`). This freezes the CLI, freezes the Streamlit UI, and hangs `pytest` in CI.

### P0-1 — Add a hard per-test timeout so the suite can never hang
- **Files:** `pyproject.toml` (add `pytest-timeout` to `[project.optional-dependencies].test`), add `[tool.pytest.ini_options]` with `timeout = 60`, `markers = ["integration: needs Java/real readers"]`.
- **Do:** Register `pytest-timeout`; set a global 60s timeout; register the `integration` marker.
- **Done when:** `pytest -q` fails a hung test within 60s instead of hanging forever; `-m "not integration"` selection works.
- **Depends on:** none.

### P0-2 — Split the bioio-dependent extraction into a standalone module-level function
- **Files:** `src/microscopy_naming_assistant/metadata.py`.
- **Do:** Extract the bioio block (currently inside `extract_metadata`, the `try: from bioio import BioImage ...` section) into a top-level function `_extract_bioio_fields(file_path: Path) -> dict[str, str]` that returns only the bioio-derived fields (markers/magnification/exptype/sample). No behavior change yet; `extract_metadata` calls it inline. Must be module-level (picklable) — no closures.
- **Done when:** existing `test_metadata.py` still passes (run as integration if it now needs Java); the function is importable as `metadata._extract_bioio_fields`.
- **Depends on:** none.

### P0-3 — Bound bioio extraction with a process timeout + fallback (the core fix)
- **Files:** `src/microscopy_naming_assistant/metadata.py`, `src/microscopy_naming_assistant/config.py`, new `tests/test_metadata_timeout.py`.
- **Do:**
  - Add `extraction_timeout_seconds: int = 20` to `NamingConfig` (+ save/load in `config.py`, `.get` fallback).
  - Add `extract_metadata(file_path, timeout_seconds: int = 20)`; run `_extract_bioio_fields` in a `multiprocessing.get_context("spawn")` `Process` that puts its result dict on a `Queue`.
  - `p.join(timeout_seconds)`; if `p.is_alive()`, `p.terminate()` + `p.join()` and return the filename/mtime heuristics only (do **not** read the queue after terminate). On clean exit, read the dict with `q.get(timeout=1)`, guarding `queue.Empty` → `{}`.
  - The date/sample/filename heuristics stay in the parent so a timeout still yields a usable name.
- **Done when:** a new test monkeypatches `_extract_bioio_fields` to `time.sleep(30)` and asserts `extract_metadata(tmpfile, timeout_seconds=2)` returns within ~3s with the heuristic date/sample present. Fast suite green.
- **Depends on:** P0-2.

### P0-4 — Plumb the timeout through the service layer
- **Files:** `src/microscopy_naming_assistant/service.py`.
- **Do:** In `suggest_for_file`, pass `timeout_seconds=int(config.extraction_timeout_seconds)` into `extract_metadata`.
- **Done when:** batch/suggest use the configured timeout; a unit test asserts the value is forwarded (monkeypatch `extract_metadata`, assert kwarg).
- **Depends on:** P0-3.

### P0-5 — Mark real-reader tests `integration` and make default CI green
- **Files:** `tests/test_metadata.py`, `tests/test_service_and_cli.py` (any test that reaches real bioio), `.github/workflows/ci.yml`.
- **Do:** Add `@pytest.mark.integration` to tests that exercise real readers/Java. Change the CI "Run tests" step to `pytest -q -m "not integration"`. Add a second, non-blocking CI job (or `continue-on-error: true`) that sets up Java (`actions/setup-java`) and runs `-m integration`.
- **Done when:** default CI job finishes in seconds and is green; integration job is separate and clearly optional.
- **Depends on:** P0-3 (so the guarded path is what integration exercises).

### P0-6 — Add `multiprocessing.freeze_support()` for the packaged exe
- **Files:** `run_main.py`.
- **Do:** Call `multiprocessing.freeze_support()` at the very top of the `if __name__ == "__main__":` block (required for `spawn` under PyInstaller, now that P0-3 spawns processes).
- **Done when:** line present and ordered before Streamlit launch. (Full exe rebuild is the user's step; build artifacts are out of date and not tracked here.)
- **Depends on:** P0-3.

### P0-7 — Show progress/feedback in the UI during extraction
- **Files:** `app_streamlit.py`.
- **Do:** Wrap `plan_batch`, the uploaded-file loop, and `suggest_for_file` calls in `st.spinner("Reading metadata…")`. After a plan, surface any files that hit the timeout (fields fell back to defaults) as an info note.
- **Done when:** long operations show a spinner; no silent freeze. Manual check.
- **Depends on:** P0-3.

---

## Phase 1 — Correctness & honesty

### P1-1 — Remove config fields that are advertised but never used
- **Files:** `src/microscopy_naming_assistant/config.py`, `naming_scheme.json`, `README.md`, `ERRORS.md`.
- **Do:** Remove `field_separator` and `marker_separator` from `NamingConfig`, `save_config`, and the sample JSON. Field separation is already governed by `template`; marker joining is a fixed `-`. Document that in the README config section. Remove the stale ERRORS.md line about unenforced separators.
- **Recommended:** removal (honesty, minimal risk — `load_config` already ignores unknown JSON keys, so existing user files won't break). *Alternative if the user wants configurable marker separators instead:* wire `marker_separator` into the two joins in `metadata.py` and `validation._split_markers` — larger, deferred.
- **Done when:** no references to the removed fields remain (`grep` clean); config round-trip test still passes.
- **Depends on:** none. ⚠ Decision: remove vs wire in (plan assumes remove).

### P1-2a — Add unified field-assembly helpers to `naming.py`
- **Files:** `src/microscopy_naming_assistant/naming.py`, `tests/test_naming.py`.
- **Do:** Add `finalize_fields(source_path, extracted, config) -> dict[str,str]` that merges defaults, adds `ext`, and normalizes — the single source of truth. Add `render_name(fields, config) -> str` that only formats+collapses separators. Keep `build_filename` working by delegating to both (back-compat).
- **Done when:** new unit tests cover `finalize_fields` (defaults merged once, ext set, uppercase applied) and `render_name`; existing naming tests pass.
- **Depends on:** none.

### P1-2b — Make `suggest_for_file` validate and name from one dict
- **Files:** `src/microscopy_naming_assistant/service.py`, `tests/test_service_and_cli.py`.
- **Do:** Replace the double merge (service.py:51 + `build_filename` re-merge) with a single `fields = finalize_fields(...)`; validate `fields`; name via `render_name(fields, config)`. Remove the now-redundant local `merged`/`normalized`.
- **Done when:** validated fields and the rendered name derive from the same dict; existing service tests pass; add a test asserting the LLM-merged field appears in both the name and the validated fields.
- **Depends on:** P1-2a.

### P1-2c — Update the Streamlit re-validate block to the unified helpers
- **Files:** `app_streamlit.py`.
- **Do:** In the "Re-validate & Update Fields" handler (currently importing `build_filename`/`normalize_fields`), switch to `finalize_fields`/`render_name` so edited rows go through the same path.
- **Done when:** editing a field in the data editor re-normalizes and re-names consistently; manual check.
- **Depends on:** P1-2b.

### P1-3a — Make batch recursion explicit in the service layer
- **Files:** `src/microscopy_naming_assistant/service.py`, `tests/test_service_and_cli.py`.
- **Do:** Add `recursive: bool = False` to `plan_batch`; use `glob` when False, `rglob` when True. Default is now **non-recursive** (current behavior silently recurses).
- **Done when:** a test with a nested subfolder asserts non-recursive skips it and `recursive=True` includes it.
- **Depends on:** none.

### P1-3b — Expose `--recursive` on the CLI
- **Files:** `src/microscopy_naming_assistant/cli.py`.
- **Do:** Add `--recursive` flag to `batch`; forward to `plan_batch`.
- **Done when:** `build_parser` accepts `--recursive`; forwarded value asserted in a parser test.
- **Depends on:** P1-3a.

### P1-3c — Add a "Search subfolders" checkbox to the UI
- **Files:** `app_streamlit.py`.
- **Do:** Add a checkbox (default off) in folder mode; pass to `plan_batch`.
- **Done when:** unchecked = top folder only; manual check.
- **Depends on:** P1-3a.

### P1-4a — `mna suggest --json`
- **Files:** `src/microscopy_naming_assistant/cli.py`, `tests/test_service_and_cli.py`.
- **Do:** Add `--json` to `suggest`; when set, print one JSON object (`source`, `suggested`, `fields`, `issues[]`) and suppress the human lines.
- **Done when:** a test parses stdout as JSON with the expected keys.
- **Depends on:** none (do after P1-2b if both are queued, to serialize the unified fields).

### P1-4b — `mna batch --json`
- **Files:** `src/microscopy_naming_assistant/cli.py`, `tests/test_service_and_cli.py`.
- **Do:** Add `--json` to `batch`; print `{planned:[{source,target}], skipped:[...], issues:[...]}`. Honor `--apply` (include `renamed`, `manifest`).
- **Done when:** stdout parses as JSON; dry-run vs apply covered.
- **Depends on:** none.

### P1-5 — Stop rewriting config on every Streamlit rerun
- **Files:** `app_streamlit.py`.
- **Do:** Remove the unconditional `save_config(...)` at module top. Save only when settings changed (compare against the loaded config) or behind an explicit "Save settings" button.
- **Done when:** interacting with unrelated widgets does not rewrite `naming_scheme.json` (check mtime); manual verification.
- **Depends on:** none.

### P1-6 — Preserve compound extensions (`.ome.tif`)
- **Files:** `src/microscopy_naming_assistant/naming.py`, `tests/test_naming.py`.
- **Do:** When the source ends in `.ome.tif`/`.ome.tiff`, keep the `.ome` infix in `ext` instead of collapsing to `.tif`.
- **Done when:** a test asserts `foo.ome.tif` → name ends with `.ome.tif`.
- **Depends on:** P1-2a (touches the same ext logic).

### P1-7 — Relax notes handling so free text isn't mangled
- **Files:** `src/microscopy_naming_assistant/profiles.py` (default `notes_pattern`), `profiles/facsi_default.json`, `README.md`.
- **Do:** Decide the notes policy: either allow mixed case in `notes_pattern` (e.g. `^[A-Za-z0-9_-]+$`) and drop `notes` from `uppercase_fields`, or document that notes are intentionally uppercased. Recommended: allow mixed case.
- **Done when:** a lowercase note survives normalization + validation; validation test updated.
- **Depends on:** none. ⚠ Minor decision (uppercase vs mixed-case notes).

---

## Phase 2 — Extraction quality (the core value)

### P2-1a — Externalize the marker/fluorophore dictionary
- **Files:** new `src/microscopy_naming_assistant/markers.py` (or `markers.json` + loader).
- **Do:** Replace the 9-item `KNOWN_MARKERS` with a curated dict of canonical markers → aliases (e.g. `GFP`←`eGFP`; `DAPI`; `HOECHST`←`Hoechst 33342`; `ALEXA488`←`Alexa Fluor 488`,`AF488`; `CY5`; `MCHERRY`; `TDTOMATO`; `RFP`,`YFP`,`CFP`,`SOX2`, …). Expose `canonical_markers()` and `alias_map()`.
- **Done when:** module loads; a test asserts a few alias→canonical mappings.
- **Depends on:** none. ⚠ The user (FACSI) should review/extend the marker list.

### P2-1b — Word-boundary marker matching (kill false positives)
- **Files:** `src/microscopy_naming_assistant/metadata.py`, `tests/test_metadata.py` (fast, no bioio).
- **Do:** Rewrite `_extract_markers` to match aliases on word boundaries (`\b`, case-insensitive) instead of substring `in`, and normalize to canonical form. Preserve first-seen order, dedupe.
- **Done when:** tests prove `CFP` is **not** matched inside `SCFPX`, and `Alexa Fluor 488` → `ALEXA488`. Runs without bioio.
- **Depends on:** P2-1a.

### P2-2a — Structured OME-XML extraction for OME-TIFF ⚠
- **Files:** `src/microscopy_naming_assistant/metadata.py`, `tests/data/sample.ome.tif` (small fixture), `tests/test_metadata_ome.py` (integration).
- **Do:** For OME-TIFF, read channels and `NominalMagnification` from the structured OME model (via bioio's OME metadata / `channel_names`) rather than regex over `str(metadata)`. Fall back to the regex path if the structured read fails.
- **Done when:** integration test on the fixture extracts the expected channels + magnification.
- **Depends on:** P0-3. ⚠ Needs a small real OME-TIFF sample from the user.

### P2-2b/c/d — Per-format extractors for CZI / LIF / ND2 ⚠
- **Files:** `src/microscopy_naming_assistant/metadata.py`, `tests/data/*`, integration tests.
- **Do:** One task per format; structured extraction validated against a real sample.
- **Done when:** per-format integration test passes.
- **Depends on:** P2-2a. ⚠ Needs one real sample per format from the user.

### P2-3a — Track field provenance (metadata / filename / default / llm)
- **Files:** `src/microscopy_naming_assistant/service.py`, `src/microscopy_naming_assistant/naming.py`.
- **Do:** Carry a parallel `sources: dict[str,str]` alongside fields so each value's origin is known. `finalize_fields` records `default` for defaulted fields; `extract_metadata` tags `metadata` vs `filename`; LLM merge tags `llm`. Add `sources` to `SuggestionResult`.
- **Done when:** `suggest_for_file` returns per-field sources; unit test asserts a defaulted field is tagged `default`.
- **Depends on:** P1-2b.

### P2-3b — Surface low-confidence fields for review
- **Files:** `app_streamlit.py`, `src/microscopy_naming_assistant/cli.py`.
- **Do:** In the UI, visually flag fields sourced from `default` (i.e., not really extracted) so users review before applying. In CLI `--json`, include the `sources` map.
- **Done when:** defaulted fields are visibly flagged in preview; `--json` includes sources.
- **Depends on:** P2-3a.

---

## Phase 3 — Release & UX

### P3-1 — Robust `data_editor` round-trip
- **Files:** `app_streamlit.py`.
- **Do:** Give the editor a stable key; on re-validate, re-check **all** rows (not only those that started with issues) so edits that break a clean row are caught; don't rely on positional `zip` (key by `_source`).
- **Done when:** editing a clean row into an invalid value flags it; manual check.
- **Depends on:** P1-2c.

### P3-2 — Export preview report (CSV/JSON)
- **Files:** `app_streamlit.py`, `src/microscopy_naming_assistant/cli.py`.
- **Do:** UI: `st.download_button` for the plan as CSV/JSON. CLI: `--report <path>` on `batch`.
- **Done when:** report file written with source/target/issues; CLI test covers it.
- **Depends on:** P1-4b.

### P3-3 — First-run profile/config wizard in the UI
- **Files:** `app_streamlit.py`.
- **Do:** A form to create a profile (allowed exptypes/markers, patterns) and save it, so new users aren't stuck editing JSON by hand.
- **Done when:** form writes a valid profile JSON loadable by `load_profile`; manual check.
- **Depends on:** none.

### P3-4 — Make FACSI-specific defaults opt-in / clearly marked
- **Files:** `src/microscopy_naming_assistant/config.py`, `app_streamlit.py`, `README.md`.
- **Do:** The defaults (`CT`/`E01`/`X90`/`ARL`) are lab-specific and silently produce plausible-but-wrong names. Decide: ship neutral placeholders (e.g. `UNKNOWN`) that validation flags, or keep FACSI defaults but mark defaulted fields (uses P2-3). Document the choice.
- **Done when:** a file with no extractable metadata yields clearly-flagged or blank fields, not silent lab-specific values.
- **Depends on:** P2-3b. ⚠ Decision: neutral placeholders vs flagged FACSI defaults.

### P3-5a — Project hygiene: LICENSE + CHANGELOG + README fixes
- **Files:** new `LICENSE`, new `CHANGELOG.md`, `README.md`.
- **Do:** Add a license (⚠ user picks: MIT/BSD-3/Apache-2.0). Start a Keep-a-Changelog `CHANGELOG.md`. Fix the duplicated quick-start numbering in the README.
- **Done when:** files present; README steps numbered correctly.
- **Depends on:** none. ⚠ License choice.

### P3-5b — Lint/format/type gates in CI
- **Files:** `pyproject.toml`, `.github/workflows/ci.yml`, optional `.pre-commit-config.yaml`.
- **Do:** Add `ruff` + `black` config; add a CI lint step; optionally `mypy` (non-blocking to start). Add a `py.typed` marker.
- **Done when:** `ruff check` + `black --check` pass in CI; repo formatted.
- **Depends on:** P3-5a.

---

## Needs user input (collect alongside execution)

- **⚠ P1-1:** remove the unused separator fields (recommended) vs wire `marker_separator` in.
- **⚠ P1-7:** notes uppercase vs mixed-case (recommended mixed-case).
- **⚠ P2-1a:** review/extend the marker/fluorophore dictionary for FACSI.
- **⚠ P2-2a–d:** small real sample files — one `.ome.tif`, `.czi`, `.lif`, `.nd2` — as test fixtures.
- **⚠ P3-4:** neutral placeholders vs flagged lab defaults.
- **⚠ P3-5a:** license choice.
