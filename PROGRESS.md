# Project Progress

Last updated: 2026-07-22

## Current Stage
MVP implemented and usable for local CLI and Streamlit workflows.

## Implemented
- CLI commands for config/profile init, single suggest, batch preview, and batch apply.
- Metadata extraction with format-aware heuristics and safe fallback behavior.
- Template-based filename generation with normalization/sanitization.
- Optional Ollama-based field refinement.
- Validation via lab/user profile rules.
- Streamlit UI for folder mode and drag-and-drop preview mode.
- Packaging and script entrypoint (`mna`) configured.

## Stability Snapshot
- Repository state: clean working tree on `main`.
- Core flows run end-to-end in code structure.
- No automated tests present yet.

## Known Constraints
- Scientific metadata quality varies by source format and reader availability.
- LLM enhancement depends on local Ollama availability and model quality.
- Batch apply currently performs direct renames (no rollback transaction layer).
