# Microscopy Naming Assistant

Metadata-aware microscopy file naming assistant with optional local LLM suggestions.

## What this does

- Extracts metadata from microscopy files using bioio (with Bio-Formats plugin support).
- Adds format-aware extraction heuristics for OME-TIFF, CZI, LIF, and ND2.
- Builds standardized names from a configurable template.
- Supports per-user or per-lab naming schemes via JSON config.
- Validates generated names using profile rules (experiment codes, markers, sample pattern).
- Optionally uses a local/free Ollama model to improve missing fields.
- Includes a Streamlit UI with drag-and-drop preview and folder-based apply flow.

Default naming template:

YYYY-MM-DD_EXPTYPE_SAMPLE_MAGNIFICATION_MARKERS_NOTES.tif

## Project layout

- src/microscopy_naming_assistant/cli.py: command-line interface
- src/microscopy_naming_assistant/metadata.py: metadata extraction
- src/microscopy_naming_assistant/naming.py: sanitization and filename building
- src/microscopy_naming_assistant/llm.py: optional Ollama integration
- src/microscopy_naming_assistant/config.py: per-user scheme configuration
- src/microscopy_naming_assistant/profiles.py: profile model and loader
- src/microscopy_naming_assistant/validation.py: validation engine
- src/microscopy_naming_assistant/service.py: shared suggestion and batch logic
- app_streamlit.py: desktop-style local UI
- profiles/facsi_default.json: starter lab profile

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:

pip install -r requirements.txt

3. Install this package in editable mode:

pip install -e .

4. Install test dependencies (recommended for contributors):

pip install -e .[test]

Note: Bio-Formats readers may require Java runtime depending on file formats and plugin internals.

## Optional local LLM (free tier)

If you use Ollama locally:

1. Start Ollama server:

ollama serve

2. Pull a model (example):

ollama pull qwen2.5-coder:7b

3. Enable LLM in config (see below) and run commands with --llm.

Notes:
- No API key is required for local Ollama usage.
- You can set `llm.model` to `auto` (default) to pick an installed local model automatically.

## Streamlit UI

Run local UI:

streamlit run app_streamlit.py

UI includes:

- Folder mode: preview and apply renames in-place
- Drag-and-drop mode: upload files to preview suggestions safely
- Optional strict profile validation

## Quick start

1. Create default config:

mna init-config --output naming_scheme.json

1. Create default profile:

mna init-profile --output profile.json

2. Suggest a filename for one file:

mna suggest --input path/to/file.tif --config naming_scheme.json

2. Suggest with profile validation (strict):

mna suggest --input path/to/file.tif --config naming_scheme.json --profile profiles/facsi_default.json --strict

3. Batch preview (dry-run):

mna batch --input-dir path/to/folder --pattern "*.tif" --config naming_scheme.json

3. Batch preview with validation profile:

mna batch --input-dir path/to/folder --pattern "*.tif" --config naming_scheme.json --profile profiles/facsi_default.json --strict

4. Apply batch rename:

mna batch --input-dir path/to/folder --pattern "*.tif" --config naming_scheme.json --apply

5. Use Ollama-assisted suggestions:

mna suggest --input path/to/file.tif --config naming_scheme.json --llm

6. Choose a specific local model without editing JSON:

mna suggest --input path/to/file.tif --config naming_scheme.json --llm --llm-model llama3.1:8b

## Config format

The generated naming_scheme.json is user-tailorable. Important fields:

- template: naming pattern
- defaults: fallback values for missing metadata
- uppercase_fields: fields to force uppercase
- llm.enabled: true/false
- llm.model: Ollama model name (or auto)
- llm.preferred_models: priority order used when llm.model is auto
- llm.endpoint: default http://localhost:11434/api/chat

## Profile format

Profile JSON controls validation policy for each user or lab:

- allowed_experiment_types
- allowed_markers
- sample_pattern
- magnification_pattern
- notes_pattern
- unknown_marker_policy (allow, warn, block)

Example profile is included at profiles/facsi_default.json.

Example LLM section:

{
	"llm": {
		"enabled": true,
		"model": "auto",
		"preferred_models": ["llama3.1:8b", "qwen2.5-coder:7b", "phi3:mini"],
		"endpoint": "http://localhost:11434/api/chat",
		"timeout_seconds": 30
	}
}

## Notes

- The CLI is safe by default: batch mode is dry-run unless you add --apply.
- If metadata readers are unavailable for a file, the tool falls back to timestamp and filename heuristics.
- You can maintain multiple config files for different users, projects, or experiments.

## Run tests

Run the test suite:

python -m pytest -q

