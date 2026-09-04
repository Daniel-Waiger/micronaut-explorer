# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Scope:** this changelog covers **Micronaut Classic** (the Python renamer), which is
> now **parked — not going forward in the near term** (see [ROADMAP.md](ROADMAP.md)). The
> entries below record what shipped before it was parked. The active web Planner tracks
> its day-to-day status in [ROADMAP.md](ROADMAP.md) and [TASKS.md](TASKS.md), and its
> releases in [web/release-notes/CHANGELOG.md](web/release-notes/CHANGELOG.md), not here.

## [Unreleased]

### Fixed
- Metadata extraction (`extract_metadata`) could hang indefinitely on files bioio/Bio-Formats
  could not parse (confirmed >40s on an unreadable `.tif`), freezing the CLI, the Streamlit UI,
  and CI. Extraction is now bounded by a per-file process timeout (`extraction_timeout_seconds`,
  default 20s) with a heuristic (filename/mtime) fallback on timeout.
- CI no longer hangs: reader/Bio-Formats-dependent tests are split behind an `integration` pytest
  marker, so the default test run (`pytest -m "not integration"`) is fast and green; a global
  `pytest-timeout` is also in place as a safety net.
- Synthesized channel names (`Channel:0:0`, `C0`, …) that bioio emits when a format carries no
  real channel names were being written into filenames as if they were fluorophores — and, worse,
  they unconditionally overwrote markers that had been correctly parsed from the filename or
  metadata. They are now recognized as placeholders and discarded.
- Metadata extraction could never have returned a large payload from its subprocess: the parent
  called `Process.join(timeout)` *before* reading the queue, but a `Queue.put` larger than the
  OS pipe buffer (~64KB) blocks the child until the parent drains it. Any metadata-rich file
  would therefore have been declared timed-out and killed, losing the payload. The parent now
  reads before joining.
- `_extract_near_key` could not read the `KeyName = value` shape that vendor metadata
  overwhelmingly uses (`ObjectiveName`, `ExperimentName`, `ChannelName #0`): anchoring on a hint
  like `Objective` matched, then captured the remainder of the *key name* rather than the value,
  so fields plainly present in the metadata were silently missed.
- Extraction blobs are now trimmed per section rather than truncating the joined string, so one
  verbose section (a large OME-XML dump) can no longer crowd every later section out entirely.
- The LLM could overwrite a field that had genuinely been extracted from the file; it now fills
  only missing fields, matching the documented enhancer-not-originator contract that the prompt
  already claimed.
- Drag-and-drop upload in the Streamlit UI wrote and read each file one at a time, so a batch
  containing companion files (e.g. a multi-file OME-TIFF set, whose planes reference each other
  by filename) raised `FileNotFoundError`. The whole batch is now written to the temporary
  directory before any of it is read.

### Added
- Full metadata extraction, replacing a read that only ever saw a thin slice of each file.
  Previously the extractor scanned `str(BioImage.metadata)` alone; for an ImageJ/Fiji-exported
  TIFF that is just the structural header (`ImageJ=1.54f images=210 channels=3 ...`), so the
  vendor acquisition record Fiji shows under Image > Show Info was invisible and such files
  named out as `UNKNOWN`. Extraction now harvests every reachable surface into one labelled
  blob: `metadata`, the structured `ome_metadata` model, `channel_names`,
  `physical_pixel_sizes`, `dims`, per-scene metadata for multi-series containers (LIF series /
  CZI scenes / ND2 points), and raw TIFF tags — including the ImageJ `Info` block
  (`IJMetadata`), which is where an ImageJ export stashes the original vendor metadata.
- Acquisition date is now read from metadata (`AcquisitionDate`, `CreationDate`, `DateTime`, …)
  instead of always deriving `date` from the file mtime, which is usually the date the file was
  *copied* rather than acquired.
- The LLM is now grounded in the file's own metadata: `suggest_fields_with_ollama` takes a
  `metadata_text` argument and includes it in the prompt alongside the filename, so it can
  recover fields stated in vendor prose that no regex was written for. The prompt instructs it
  to prefer the metadata over the filename when the two disagree. Blob is truncated to keep a
  small local model's context window usable.
- Free-text "Experiment description" input in the Streamlit UI and `--describe` on `mna suggest`
  / `mna batch`, wired into the LLM's existing `user_description` context (previously accepted
  by `llm.py` but never supplied by any caller).
- "Metadata read from files" viewer in the Streamlit UI and `--show-metadata` on `mna suggest`,
  showing exactly what the reader found — so a missing field can be diagnosed as genuinely
  absent from the file rather than missed by the extractor. `mna suggest --json` now also
  reports `reader` and `extraction_error`.
- Native bioio reader plugins (`bioio-ome-tiff`, `bioio-tifffile`, `bioio-lif`, `bioio-nd2`)
  so OME-TIFF, TIFF, LIF, and ND2 files are read with plain Python/C readers instead of
  spinning up a JVM through Bio-Formats; bioio auto-prefers these native, more specific
  readers over `bioio-bioformats`, which remains installed as the fallback for formats none
  of them claim. `bioio-czi` (native CZI) is available as an optional `czi` extra
  (`pip install .[czi]`) rather than a hard dependency: it requires a C++ build toolchain
  (CMake) to build from source on platforms without a prebuilt wheel (confirmed failing on
  this machine's Python 3.14/Windows combination); `.czi` files still work via the
  Bio-Formats fallback without it.
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
- Fallback extraction for images whose embedded metadata was stripped (e.g. ImageJ `.tif`
  exports), so they no longer fall straight through to placeholder defaults:
  - An optional `filename_extraction_mask` on a profile reads fields out of filenames that
    already follow a convention (`{date}_{exptype}_{sample}_{magnification}`; placeholders:
    `date`, `exptype`, `sample`, `magnification`, `markers`, `notes`). Each placeholder matches a
    single segment and the whole filename must match, so a non-conforming file is skipped rather
    than half-parsed. A mask outranks values read from the file's own metadata. Exposed in the
    Streamlit profile wizard and documented in the README/user guide.
  - Deterministic keyword scanning of the filename stem now recovers magnification written as
    `x 93` and samples written as `embryo 3`/`sample 3`, and looks for markers in the stem.
  - Anything still missing after those two passes falls through to the existing (optional) Ollama
    step, keeping the deterministic-first, LLM-as-enhancer ordering.
- `scripts/hardware_check.py`: reports system RAM/VRAM and suggests a local open-weights model
  size, groundwork for the planned open-weights model support.

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
- Hardened the LLM prompt in `suggest_fields_with_ollama`: it now spells out an explicit,
  numbered set of guardrails (allowed keys only; never fabricate markers/experiment
  type/sample/magnification/date from weak or absent cues -- omit the key instead of guessing;
  never overwrite a value already present in the current fields; format only, no invented
  biological identity). Naming stays deterministic-first (metadata + keywords build the base
  name); the LLM only *enhances* it, grounded in the extracted metadata, the filename, and an
  optional new `user_description` argument (authoritative context supplied by the user) -- it
  must never originate unsupported biological identity.
