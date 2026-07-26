# Project Progress

Last updated: 2026-07-26

## Current Stage
MVP implemented and usable for local CLI and Streamlit workflows. Expanding scope towards local open-weight model integration and experimental design assistance.

## Update: 2026-07-26 (later)

Root-caused the "Fiji shows plenty of metadata, the app shows UNKNOWN" discrepancy and closed it.

- **Diagnosis**: the extractor only ever scanned `str(BioImage.metadata)`. For an ImageJ/Fiji-exported TIFF that string is *only* the structural header (`ImageJ=1.54f images=210 channels=3 ...`, ~60 chars). The vendor acquisition record Fiji displays under Image > Show Info lives in the TIFF `IJMetadata` tag's `Info` field, which bioio does not surface at all. Verified on a synthetic ImageJ TIFF: `.metadata` returned 63 chars while ~600 chars of objective/channel/date detail sat one tag away.
- **Full extraction**: `_collect_metadata_text` now harvests `metadata`, `ome_metadata`, `channel_names`, `physical_pixel_sizes`, `dims`, per-scene metadata for multi-series containers, and raw TIFF tags including the ImageJ `Info` block, into one labelled blob that is both scanned and retained.
- **LLM gets metadata + filename**: `suggest_fields_with_ollama` takes `metadata_text` and includes it in the prompt, told to prefer it over the filename on disagreement. Free-text experiment description finally wired up (UI text area + `--describe`), feeding the long-unused `user_description` parameter.
- **Bugs found and fixed along the way**: placeholder channel names (`Channel:0:0`) were being written into filenames as fluorophores and overwriting correct markers; the subprocess queue was joined before being read, which would have discarded any payload above the ~64KB pipe buffer; `_extract_near_key` could not parse the `ObjectiveName = ...` shape vendor metadata overwhelmingly uses; blob truncation dropped the richest section; the LLM could overwrite genuinely-extracted values.
- **Result on the ImageJ sample**: `CHANGELOG`-worthy end to end — was `markers=CHANNEL:0:0-CHANNEL:0:1-CHANNEL:0:2` with an mtime date and everything else UNKNOWN; now `2025-02-03_UNKNOWN_E03_X93_SOX-ARL-GFP-DAPI_UNSPECIFIED.tif`, with date/sample/magnification/markers all sourced from `metadata`.
- **Transparency**: new "Metadata read from files" viewer in the UI and `--show-metadata` on the CLI, so a missing field is diagnosable as absent-from-file vs missed-by-extractor.
- Test suite: 87 passing (fast + integration).

## Update: 2026-07-26
- **Roadmap Expansion**: Added "Open-weights model support" (Qwen 3.5, Gemma 30) and "Microscopy experimental-design assistant" to `ROADMAP.md`.
- **Hardware Diagnostics**: Created `scripts/hardware_check.py` using `psutil`/`powershell` to profile system RAM and VRAM for upcoming local model deployments.
- **Streamlit Reliability**: Refactored the drag-and-drop upload logic to persist entire file batches to a temporary directory before extraction, resolving `FileNotFoundError` crashes when companion files (e.g. `.ome.tif`) are uploaded together.
- **Robust Metadata Fallbacks**: Implemented a multi-tier fallback pipeline for stripped-metadata images (e.g., ImageJ `.tif` exports):
  - **Masks**: Added a configurable `filename_extraction_mask` to `ProfileRules`. Placeholders are segment-bounded and the whole stem must match, so a non-conforming file is skipped rather than half-parsed; a mask outranks bioio-derived values. Exposed in the Streamlit profile wizard and documented in README/USER_GUIDE.
  - **Keyword scanning**: Deterministic heuristics now parse magnification (e.g. "x 93") and sample (e.g. "embryo 3") from the filename stem. The loose bare-`X` magnification match is gated to filename text only — in a raw metadata dump "512 x 512" would otherwise read as a magnification.
  - **LLM**: Remaining gaps fall through to the existing Ollama integration (`suggest_fields_with_ollama`), preserving deterministic-first ordering.
  - Covered by new fast tests in `tests/test_metadata.py` and `tests/test_config_profiles.py`.

## Implemented
- CLI commands for config/profile init, single suggest, batch preview, and batch apply.
- Metadata extraction with format-aware heuristics and safe fallback behavior.
- Template-based filename generation with normalization/sanitization.
- Optional Ollama-based field refinement.
- Validation via lab/user profile rules.
- Streamlit UI for folder mode and drag-and-drop preview mode.
- Packaging and script entrypoint (`mna`) configured.

## Stability Snapshot
- Repository state: Active development.
- Core flows run end-to-end in code structure.
- No automated tests present yet.

## Known Constraints
- Scientific metadata quality varies by source format and reader availability.
- LLM enhancement depends on local Ollama availability and model quality.
- Batch apply currently performs direct renames (no rollback transaction layer).
