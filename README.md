# Microscopy Naming Assistant

Metadata-aware microscopy file naming assistant with optional local LLM suggestions.

## What this does

- Extracts metadata from microscopy files using bioio (with Bio-Formats plugin support).
- Builds standardized names from a configurable template.
- Supports per-user or per-lab naming schemes via JSON config.
- Optionally uses a local/free Ollama model to improve missing fields.

Default naming template:

YYYY-MM-DD_EXPTYPE_SAMPLE_MAGNIFICATION_MARKERS_NOTES.tif

## Project layout

- src/microscopy_naming_assistant/cli.py: command-line interface
- src/microscopy_naming_assistant/metadata.py: metadata extraction
- src/microscopy_naming_assistant/naming.py: sanitization and filename building
- src/microscopy_naming_assistant/llm.py: optional Ollama integration
- src/microscopy_naming_assistant/config.py: per-user scheme configuration

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:

pip install -r requirements.txt

3. Install this package in editable mode:

pip install -e .

Note: Bio-Formats readers may require Java runtime depending on file formats and plugin internals.

## Optional local LLM (free tier)

If you use Ollama locally:

1. Start Ollama server:

ollama serve

2. Pull a model (example):

ollama pull qwen2.5-coder:7b

3. Enable LLM in config (see below) and run commands with --llm.

## Quick start

1. Create default config:

mna init-config --output naming_scheme.json

2. Suggest a filename for one file:

mna suggest --input path/to/file.tif --config naming_scheme.json

3. Batch preview (dry-run):

mna batch --input-dir path/to/folder --pattern "*.tif" --config naming_scheme.json

4. Apply batch rename:

mna batch --input-dir path/to/folder --pattern "*.tif" --config naming_scheme.json --apply

5. Use Ollama-assisted suggestions:

mna suggest --input path/to/file.tif --config naming_scheme.json --llm

## Config format

The generated naming_scheme.json is user-tailorable. Important fields:

- template: naming pattern
- defaults: fallback values for missing metadata
- uppercase_fields: fields to force uppercase
- llm.enabled: true/false
- llm.model: Ollama model name
- llm.endpoint: default http://localhost:11434/api/chat

Example LLM section:

{
	"llm": {
		"enabled": true,
		"model": "qwen2.5-coder:7b",
		"endpoint": "http://localhost:11434/api/chat",
		"timeout_seconds": 30
	}
}

## Notes

- The CLI is safe by default: batch mode is dry-run unless you add --apply.
- If metadata readers are unavailable for a file, the tool falls back to timestamp and filename heuristics.
- You can maintain multiple config files for different users, projects, or experiments.

