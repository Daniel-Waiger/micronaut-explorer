# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Metadata extraction (`extract_metadata`) could hang indefinitely on files bioio/Bio-Formats
  could not parse (confirmed >40s on an unreadable `.tif`), freezing the CLI, the Streamlit UI,
  and CI. Extraction is now bounded by a per-file process timeout (`extraction_timeout_seconds`,
  default 20s) with a heuristic (filename/mtime) fallback on timeout.
- CI no longer hangs: reader/Bio-Formats-dependent tests are split behind an `integration` pytest
  marker, so the default test run (`pytest -m "not integration"`) is fast and green; a global
  `pytest-timeout` is also in place as a safety net.

### Added
- Apache License 2.0 (`LICENSE`, `NOTICE`) and license metadata in pyproject.
- `--json` output for `mna suggest` and `mna batch`, for machine-readable/scripted use.
- `--recursive` flag for `mna batch`, and a matching "Search subfolders" checkbox in the
  Streamlit UI (batch is non-recursive by default — see Changed).
- CSV/JSON batch report export: `--report <path>` on `mna batch`, and a matching download
  button in the Streamlit UI.
- Curated marker/fluorophore dictionary (`markers.py`) with canonical names and aliases,
  replacing the old 9-item hardcoded list.
- Field provenance tracking: each suggested field is tagged with its source (`metadata`,
  `filename`, `default`, or `llm`), surfaced in the Streamlit UI (review column / summary) and
  in `mna suggest --json`.
- Profile-creation wizard in the Streamlit UI, so a new lab/user profile can be created and
  saved without hand-editing JSON.
- Spinner feedback in the Streamlit UI while metadata is read and batches are planned, so long
  operations no longer look frozen.

### Changed
- Unified field assembly: validation and filename rendering now both derive from a single
  `finalize_fields()` / `render_name()` pipeline instead of merging defaults independently in
  two places.
- `mna batch` (and the UI) default to non-recursive folder scanning; use `--recursive` /
  "Search subfolders" to opt in.
- Notes now allow mixed case (dropped from `uppercase_fields`; `notes_pattern` widened) instead
  of being forced to uppercase.
- Removed the unused `field_separator` and `marker_separator` config fields (field separation
  was already governed by `template`; marker joining is a fixed `-`).
- The Streamlit app no longer rewrites `naming_scheme.json` on every rerun; it saves only when
  settings actually change.
- Marker matching now uses word boundaries instead of substring matching, avoiding false
  positives (e.g. `CFP` inside `SCFPX`) and mapping aliases to a canonical name (e.g.
  `Alexa Fluor 488` -> `ALEXA488`).
- `.ome.tif` / `.ome.tiff` compound extensions are now preserved when building output filenames
  instead of being collapsed to `.tif`.
- Default `naming_scheme.json` values for `exptype`/`sample`/`magnification`/`markers` are now
  the neutral placeholder `UNKNOWN` instead of example FACSI-specific values (`CT`/`E01`/`X90`/
  `ARL`). These are just starter examples for a config any lab can tailor; unextracted fields
  already carry `provenance: default` (see Added, above), so they now read as obvious
  placeholders flagged for review rather than plausible-but-wrong lab values.
- `mna init-profile` / `default_profile()` now emit a neutral, permissive starter profile
  instead of FACSI-specific example values: `allowed_experiment_types` and `allowed_markers`
  are empty, and validation now treats an empty allow-list as "no restriction" instead of
  "reject everything" (the exptype/marker allow-list checks are skipped entirely when the
  corresponding list is empty). The `sample`/`magnification`/`notes` patterns are now generic
  alphanumeric shapes instead of the FACSI-specific `E##`/`X##` shapes. `profiles/facsi_default.json`
  is unchanged and remains as a separate, explicitly-named example of a restrictive lab profile
  for labs that want to start from a locked-down template.
