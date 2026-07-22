# Roadmap

Last updated: 2026-07-22

## Phase 1: Reliability Baseline (Highest Priority)
- Add unit tests for naming, validation, and config/profile loaders.
- Add integration tests for CLI suggest/batch dry-run/apply flows.
- Add deterministic fixtures for metadata extraction edge cases.
- Define and enforce expected behavior for collisions and strict mode.

## Phase 2: Safer Batch Operations
- Implement optional apply manifest/log file for every batch run.
- Add rollback support using recorded original/target paths.
- Add conflict strategy options: skip, fail, or auto-suffix.

## Phase 3: Metadata and LLM Quality
- Expand format-specific extraction logic with tested sample files.
- Improve marker parsing/token normalization across separators.
- Add optional confidence notes per extracted/suggested field.
- Harden Ollama integration with timeout handling and clear fallback messaging.

## Phase 4: UX and Operability
- Add in-app config/profile creation and validation helpers in Streamlit.
- Add exportable preview report (CSV/JSON) from UI and CLI.
- Add richer CLI output modes (`--json`) for automation pipelines.

## Phase 5: Release Readiness
- Add CI pipeline (lint, tests, packaging checks).
- Define versioning/release checklist and changelog process.
- Publish usage examples with sample profiles and troubleshooting guide.
