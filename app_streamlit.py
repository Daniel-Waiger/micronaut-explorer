from __future__ import annotations

# Add src to sys.path so we can run directly
import sys
from pathlib import Path

src_path = Path(__file__).parent / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

import copy
import json
import os
import subprocess
import tempfile

# ── Force upload limit to 10 GB (overrides the 200 MB default) ──
# Environment variables are the lightest way to set Streamlit config;
# they are read once during import with zero per-rerun overhead.
os.environ.setdefault("STREAMLIT_SERVER_MAX_UPLOAD_SIZE", "10240")  # 10 GB
os.environ.setdefault("STREAMLIT_SERVER_MAX_MESSAGE_SIZE", "10240")  # 10 GB

import streamlit as st

from microscopy_naming_assistant.config import default_config, load_config, save_config
from microscopy_naming_assistant.llm import list_local_ollama_models
from microscopy_naming_assistant.profiles import ProfileRules, save_profile
from microscopy_naming_assistant.service import apply_batch, plan_batch, suggest_for_file

st.set_page_config(page_title="μicronaut", page_icon="🔬", layout="wide")
st.title("μicronaut")
st.caption("Preview and apply naming-convention renames with optional profile validation.")


def _browse_for_folder(initial_dir: str = "") -> str | None:
    """Open a native OS folder-picker dialog on the machine running this server.

    Streamlit has no built-in folder picker (browser sandboxing means JS can't
    hand back real filesystem paths), so this drives tkinter's dialog. It runs
    in a *subprocess*, not inline: tkinter's event loop must own its process's
    main thread, and Streamlit executes this script on a ScriptRunner worker
    thread, so an inline call fails with "main thread is not in main loop".

    This only makes sense when the Streamlit server and the browser are the
    same machine -- the normal case for a local `streamlit run`. On a remote
    deployment the dialog would open on the server rather than the visitor's
    machine, which is why typing a path stays supported alongside it.
    """
    picker = src_path / "microscopy_naming_assistant" / "folder_picker.py"
    completed = subprocess.run(
        [sys.executable, str(picker), initial_dir],
        capture_output=True,
        text=True,
        timeout=600,
        # Keep a console window from flashing up on Windows; absent elsewhere.
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "folder picker failed")
    return completed.stdout.strip() or None


st.sidebar.header("Settings")
config_path = Path(st.sidebar.text_input("Config path", value="naming_scheme.json")).expanduser()

if not config_path.exists():
    config_path.parent.mkdir(parents=True, exist_ok=True)
    save_config(config_path, default_config())
    st.sidebar.info(f"Created default config at {config_path}")

config = load_config(config_path)

# Snapshot the on-disk llm settings so we can tell, after the sidebar widgets
# below have had their say, whether anything actually changed. The sidebar
# only ever mutates config.llm[...] (see the assignments before "Folder
# Mode"), so comparing this dict before/after is sufficient to decide
# whether a rewrite of config_path is needed.
loaded_llm_snapshot = copy.deepcopy(config.llm)

llm_endpoint = st.sidebar.text_input(
    "Ollama endpoint",
    value=str(config.llm.get("endpoint", "http://localhost:11434/api/chat")),
)
llm_timeout = int(
    st.sidebar.number_input(
        "LLM timeout (seconds)",
        min_value=5,
        max_value=120,
        value=int(config.llm.get("timeout_seconds", 30)),
        step=1,
    )
)

use_llm = st.sidebar.checkbox(
    "Use Ollama suggestions", value=bool(config.llm.get("enabled", False))
)

default_preferred = ["llama3.1:8b", "qwen2.5-coder:7b", "phi3:mini"]
preferred = [str(x) for x in config.llm.get("preferred_models", default_preferred)]


# Cache Ollama model discovery so a connection-timeout penalty (when Ollama is
# not running) is paid at most once per minute instead of on every rerun.
@st.cache_data(ttl=60, show_spinner=False)
def _cached_ollama_models(endpoint: str) -> list[str]:
    return list_local_ollama_models(endpoint=endpoint, timeout_seconds=2)


installed = _cached_ollama_models(endpoint=llm_endpoint)

llm_model_options = ["auto"] + preferred + installed
llm_model_options = list(dict.fromkeys(llm_model_options))
current_model = str(config.llm.get("model", "auto"))
if current_model not in llm_model_options:
    llm_model_options.append(current_model)

default_index = llm_model_options.index(current_model) if current_model in llm_model_options else 0
llm_model = st.sidebar.selectbox(
    "LLM model",
    options=llm_model_options,
    index=default_index,
    help="Use 'auto' to pick the first available preferred model locally.",
)

if use_llm and not installed:
    st.sidebar.warning(
        "No local Ollama models detected. The app will safely continue without LLM enrichment."
    )

profile_input = st.sidebar.text_input(
    "Profile path (optional)", value="profiles/facsi_default.json"
).strip()
profile_path = Path(profile_input).expanduser() if profile_input else None

if profile_path is not None and not profile_path.exists():
    st.sidebar.warning(f"Profile not found at {profile_path}. Validation will be skipped.")
    profile_path = None

strict = st.sidebar.checkbox("Strict validation", value=True)
conflict_strategy = st.sidebar.selectbox("Conflict strategy", ["suffix", "skip", "fail"], index=0)
pattern = st.sidebar.text_input("Glob pattern", value="*.tif")

config.llm["enabled"] = use_llm
config.llm["model"] = llm_model
config.llm["endpoint"] = llm_endpoint
config.llm["timeout_seconds"] = llm_timeout
config.llm["preferred_models"] = preferred

# Only rewrite naming_scheme.json when the widgets actually changed a value.
# Without this check, every rerun (i.e. every widget interaction anywhere on
# the page) would rewrite the file, even for unrelated actions like clicking
# "Preview Renames".
if config.llm != loaded_llm_snapshot:
    save_config(config_path, config)

st.subheader("Folder Mode (Preview + Apply)")

st.session_state.setdefault("folder_input_path", "")
if st.button("Browse…", use_container_width=True):
    try:
        chosen = _browse_for_folder(st.session_state["folder_input_path"])
    except Exception as exc:
        st.error(f"Could not open folder picker: {exc}")
    else:
        if chosen:
            st.session_state["folder_input_path"] = chosen
            st.rerun()

folder_input = st.text_input(
    "Input folder path",
    key="folder_input_path",
    help="Type a path, or click Browse… (opens a native folder picker; only "
    "works when running this app on your own machine).",
)

recursive = st.checkbox(
    "Search subfolders",
    value=False,
    help="Recurse into nested folders. Off = only the top folder.",
)
st.caption("Large or unreadable files fall back to filename/date heuristics after a timeout.")

if st.button("Preview Renames"):
    if not folder_input:
        st.error("Provide an input folder path.")
    else:
        input_dir = Path(folder_input).expanduser()
        if not input_dir.exists():
            st.error(f"Folder does not exist: {input_dir}")
        else:
            with st.spinner("Reading metadata and planning renames…"):
                batch = plan_batch(
                    input_dir=input_dir,
                    pattern=pattern,
                    config_path=config_path,
                    recursive=recursive,
                    use_llm=use_llm,
                    profile_path=profile_path,
                    strict=strict,
                    llm_model_override=llm_model,
                    conflict_strategy=conflict_strategy,
                )

            st.session_state["suggestions"] = batch.suggestions
            st.session_state["input_dir"] = input_dir

if "suggestions" in st.session_state:
    input_dir = st.session_state["input_dir"]
    suggestions = st.session_state["suggestions"]

    defaulted_count = sum(
        1 for s in suggestions if any(v == "default" for k, v in s.sources.items() if k != "ext")
    )

    st.write("### Tag Files")
    st.caption(
        "Every previewed file is listed below with its naming fields, pre-filled from "
        "extracted metadata (or filename/date heuristics) where possible. The "
        '"needs review" column lists fields that could not be extracted and fell back '
        "to a default (e.g. UNKNOWN) — check those. Edit any cell to control the final "
        "filename directly, without needing the LLM. "
        f"({defaulted_count} of {len(suggestions)} file(s) currently need review.)"
    )

    # Naming-field columns, in first-seen order, shared by every suggestion
    # (config.defaults guarantees the same key set for all of them); "ext" is
    # rendered onto the name automatically and isn't user-editable.
    field_names = list(dict.fromkeys(k for s in suggestions for k in s.fields if k != "ext"))

    tag_rows = []
    for s in suggestions:
        row = {"file": s.source.name}
        for name in field_names:
            row[name] = s.fields.get(name, "")
        row["needs review"] = ", ".join(
            k for k, v in s.sources.items() if v == "default" and k != "ext"
        )
        row["issues"] = "; ".join(f"{i.severity}:{i.field}" for i in s.issues)
        tag_rows.append(row)

    edited_rows = st.data_editor(
        tag_rows,
        key="tag_table",
        use_container_width=True,
        num_rows="fixed",
        disabled=["file", "needs review", "issues"],
    )

    experiment_description = st.text_area(
        "Experiment description (optional)",
        key="experiment_description",
        placeholder=(
            "Describe what you did, in plain language — e.g. "
            '"CT electroporation, sox/arl/gfp/dapi, embryo 3, 93x glycerol objective". '
            "Used only by the LLM, as authoritative context alongside the file's own metadata."
        ),
        height=80,
    )

    tag_button_col, llm_button_col = st.columns(2)
    apply_tags_clicked = tag_button_col.button("Apply tags & preview names")
    suggest_llm_clicked = llm_button_col.button("Suggest missing fields with LLM")

    if apply_tags_clicked:
        from microscopy_naming_assistant.naming import finalize_fields, render_name
        from microscopy_naming_assistant.profiles import load_profile
        from microscopy_naming_assistant.validation import validate_fields

        profile = load_profile(profile_path) if profile_path else None
        by_name = {s.source.name: s for s in suggestions}

        for row in edited_rows:
            s = by_name.get(row["file"])
            if s is None:
                continue
            edited_fields = {
                k: v for k, v in row.items() if k not in ("file", "needs review", "issues")
            }
            s.fields = finalize_fields(s.source, edited_fields, config)
            s.target_name = render_name(s.fields, config)
            s.issues = validate_fields(s.fields, profile) if profile else []
        st.rerun()

    if suggest_llm_clicked:
        from microscopy_naming_assistant.llm import suggest_fields_with_ollama
        from microscopy_naming_assistant.naming import finalize_fields, render_name
        from microscopy_naming_assistant.profiles import load_profile
        from microscopy_naming_assistant.validation import validate_fields

        profile = load_profile(profile_path) if profile_path else None
        filled_count = 0

        with st.spinner("Asking the local LLM…"):
            for s in suggestions:
                missing_fields = [k for k, v in s.sources.items() if v == "default" and k != "ext"]
                if not missing_fields:
                    continue

                current_fields = {k: v for k, v in s.fields.items() if k != "ext"}
                llm_fields = suggest_fields_with_ollama(
                    current_fields=current_fields,
                    original_name=s.source.name,
                    endpoint=str(config.llm.get("endpoint", llm_endpoint)),
                    model=llm_model,
                    timeout_seconds=int(config.llm.get("timeout_seconds", llm_timeout)),
                    preferred_models=[str(x) for x in config.llm.get("preferred_models", [])],
                    user_description=experiment_description or None,
                    metadata_text=s.metadata_text,
                )

                merged = dict(current_fields)
                for name in missing_fields:
                    value = llm_fields.get(name, "")
                    if value:
                        merged[name] = value
                        s.sources[name] = "llm"
                        filled_count += 1

                s.fields = finalize_fields(s.source, merged, config)
                s.target_name = render_name(s.fields, config)
                s.issues = validate_fields(s.fields, profile) if profile else []

        if filled_count > 0:
            st.success(
                f"Filled {filled_count} field(s) from LLM suggestions — "
                "review them in the table."
            )
            st.rerun()
        else:
            st.info(
                "No LLM suggestions available. Is Ollama running and a model installed? "
                "You can still tag fields manually."
            )

    with st.expander("Metadata read from files", expanded=False):
        st.caption(
            "Exactly what the reader found inside each file — the same record Fiji shows "
            "under Image > Show Info. Use it to check whether a field was genuinely absent "
            "from the file or merely missed by the extractor."
        )
        no_metadata = [s.source.name for s in suggestions if not s.metadata_text]
        if no_metadata:
            st.warning(
                f"{len(no_metadata)} file(s) yielded no readable metadata: "
                + ", ".join(no_metadata[:5])
                + ("…" if len(no_metadata) > 5 else "")
            )
        chosen = st.selectbox(
            "File", [s.source.name for s in suggestions], key="metadata_viewer_file"
        )
        selected = next((s for s in suggestions if s.source.name == chosen), None)
        if selected is not None:
            st.caption(f"Reader: {selected.reader or 'none'}")
            if selected.extraction_error:
                st.error(f"Extraction problem: {selected.extraction_error}")
            st.code(selected.metadata_text or "(no metadata found in this file)")

            st.write("#### Harvested metadata keys")
            if not selected.key_paths:
                st.caption("No addressable metadata keys were harvested for this file.")
            else:
                key_filter = st.text_input(
                    "Filter keys/values",
                    key="metadata_key_filter",
                    placeholder="Type to filter by key or value (case-insensitive)…",
                )
                needle = key_filter.strip().lower()
                key_rows = [
                    {"key": k, "value": v}
                    for k, v in sorted(selected.key_paths.items())
                    if not needle or needle in k.lower() or needle in v.lower()
                ]
                st.caption(f"{len(key_rows)} of {len(selected.key_paths)} key(s) shown.")
                st.dataframe(key_rows, use_container_width=True)

            st.write("#### Field provenance")
            st.caption(
                "Which metadata key produced each naming field's value -- a value that "
                "only says 'metadata' is what let a 40x objective be reported as X1."
            )
            if not selected.field_key_provenance:
                st.caption("No naming field was resolved from an exact metadata key for this file.")
            else:
                for prov_field, prov_key in sorted(selected.field_key_provenance.items()):
                    # Show what the KEY says, not the current field value: the
                    # field may since have been LLM-filled or hand-edited, and
                    # attributing an edited value to a metadata key would be
                    # precisely the false provenance this panel exists to expose.
                    key_value = selected.key_paths.get(prov_key, "")
                    current = selected.fields.get(prov_field, "")
                    line = f"{prov_field} = {current}  (from key: {prov_key} = {key_value})"
                    if selected.sources.get(prov_field) != "metadata":
                        line += (
                            f"  — now overridden ({selected.sources.get(prov_field, 'unknown')})"
                        )
                    st.write(line)

            st.write("#### Field → metadata key mapping")
            st.caption(
                "Override which exact metadata key feeds each naming field. Takes effect "
                "on the next extraction (Preview Renames)."
            )
            from microscopy_naming_assistant.field_map import MAPPABLE_FIELDS
            from microscopy_naming_assistant.profiles import load_profile

            current_field_key_map: dict[str, str] = {}
            if profile_path is not None:
                try:
                    current_field_key_map = dict(load_profile(profile_path).field_key_map)
                except Exception:
                    current_field_key_map = {}

            key_options = ["(automatic)"] + sorted(selected.key_paths)
            chosen_field_key_map: dict[str, str] = {}
            for mappable_field in MAPPABLE_FIELDS:
                preselected = current_field_key_map.get(mappable_field, "(automatic)")
                default_index = key_options.index(preselected) if preselected in key_options else 0
                chosen_field_key_map[mappable_field] = st.selectbox(
                    mappable_field,
                    options=key_options,
                    index=default_index,
                    key=f"fieldmap_{mappable_field}",
                )

            if st.session_state.pop("field_map_saved", None):
                st.success(f"Saved field mapping to {profile_path}")

            if st.button("Save mapping to profile"):
                if profile_path is None:
                    st.info(
                        "No profile is configured. Select or create a profile path in the "
                        "sidebar (or below, under 'Create a validation profile') before "
                        "saving a field mapping."
                    )
                else:
                    try:
                        mapping_profile = load_profile(profile_path)
                        # MERGE, never replace. The dropdowns only offer keys present
                        # in the file being viewed, so a field mapped to a key this
                        # file lacks shows as "(automatic)" — not because the user
                        # cleared it, but because it was unrepresentable here.
                        # Replacing wholesale would silently delete that mapping the
                        # moment the user saved while viewing a different file.
                        merged = dict(mapping_profile.field_key_map or {})
                        for field_name, key in chosen_field_key_map.items():
                            if key != "(automatic)":
                                merged[field_name] = key
                            elif merged.get(field_name) in key_options:
                                # Was offered here and the user chose automatic:
                                # a genuine clear.
                                merged.pop(field_name, None)
                        mapping_profile.field_key_map = merged
                        save_profile(profile_path, mapping_profile)
                        st.session_state["field_map_saved"] = True
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Could not save mapping: {exc}")

    from microscopy_naming_assistant.cli import (
        REPORT_COLUMNS,
        SIDECAR_COLUMNS,
        _batch_report_rows,
        rows_to_csv,
    )
    from microscopy_naming_assistant.service import build_series_rows, recalculate_batch

    batch = recalculate_batch(input_dir, suggestions, strict, conflict_strategy)

    st.write("### Planned Renames")
    table_rows = [{"source": src.name, "suggested": dst.name} for src, dst in batch.planned]
    st.dataframe(table_rows, use_container_width=True)

    # Reuse the CLI's own row-builder + CSV writer so this download, the JSON
    # download below, and `mna batch --report` can never drift out of sync.
    report_rows = _batch_report_rows(batch)

    st.download_button(
        "Download report (CSV)",
        data=rows_to_csv(report_rows, REPORT_COLUMNS),
        file_name="rename_report.csv",
        mime="text/csv",
        key="download_report_csv",
    )
    st.download_button(
        "Download report (JSON)",
        data=json.dumps(report_rows, indent=2),
        file_name="rename_report.json",
        mime="application/json",
        key="download_report_json",
    )

    # Per-series sidecar: download-only detail for multi-image containers
    # (LIF/ND2/CZI/OME-TIFF). These rows are never merged into batch.planned
    # and never drive a rename -- see build_series_rows' safety constraint.
    series_rows = build_series_rows(batch.suggestions, config)
    if series_rows:
        st.download_button(
            "Download per-series sidecar (CSV)",
            data=rows_to_csv(series_rows, SIDECAR_COLUMNS),
            file_name="rename_report_sidecar.csv",
            mime="text/csv",
            key="download_sidecar_csv",
        )
        st.download_button(
            "Download per-series sidecar (JSON)",
            data=json.dumps(series_rows, indent=2),
            file_name="rename_report_sidecar.json",
            mime="application/json",
            key="download_sidecar_json",
        )
    else:
        st.caption(
            "No multi-image containers (LIF/ND2/CZI/OME-TIFF) found in this batch — "
            "nothing to include in a per-series sidecar."
        )

    if batch.skipped:
        st.warning("Skipped items")
        for item in batch.skipped:
            st.write(f"- {item}")

    if batch.suggestions and not any(s.issues for s in batch.suggestions):
        st.success("All clear! Ready to apply.")

    if st.button("Apply Renames", type="primary"):
        renamed, manifest = apply_batch(input_dir, batch.planned)
        st.success(f"Successfully renamed {renamed} files.")
        if manifest:
            st.info(f"Manifest saved for rollback: `{manifest.name}`")

st.subheader("Drag-and-Drop Mode (Suggestion Preview)")
st.caption(
    "Upload files to preview names. For safety, this mode does not modify original source files."
)
uploaded = st.file_uploader(
    "Drop microscopy files here",
    accept_multiple_files=True,
    type=["tif", "tiff", "czi", "lif", "nd2"],
)

if uploaded:
    preview_rows = []
    with tempfile.TemporaryDirectory(prefix="mna_upload_") as tmp:
        tmp_dir = Path(tmp)
        with st.spinner("Reading metadata…"):
            # Persist the whole batch before reading any of it: companion files
            # (e.g. a multi-file OME-TIFF set) reference each other by name, so
            # reading file 1 fails unless file 2 is already on disk.
            for file_obj in uploaded:
                tmp_path = tmp_dir / file_obj.name
                tmp_path.write_bytes(file_obj.getbuffer())

            for file_obj in uploaded:
                tmp_path = tmp_dir / file_obj.name
                result = suggest_for_file(
                    file_path=tmp_path,
                    config_path=config_path,
                    use_llm=use_llm,
                    profile_path=profile_path,
                    llm_model_override=llm_model,
                )
                defaulted = [k for k, v in result.sources.items() if v == "default"]
                preview_rows.append(
                    {
                        "source": file_obj.name,
                        "suggested": result.target_name,
                        "issues": "; ".join([f"{i.severity}:{i.field}" for i in result.issues]),
                        "review (defaulted)": ", ".join(defaulted),
                    }
                )
    st.dataframe(preview_rows, use_container_width=True)

st.divider()
st.subheader("Rollback Manager")
st.caption("Revert batch renames using saved JSON manifests.")
rollback_dir = st.text_input("Target Directory (folder containing renamed files)", value="")
manifest_file = st.file_uploader("Upload Manifest JSON", type=["json"])

if st.button("Run Rollback"):
    if not rollback_dir or not manifest_file:
        st.error("Provide a target directory and upload a manifest.")
    else:
        import tempfile

        from microscopy_naming_assistant.manifest import rollback_manifest

        with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp:
            tmp.write(manifest_file.getvalue())
            tmp_path = Path(tmp.name)

        r_dir = Path(rollback_dir).expanduser()
        if not r_dir.exists():
            st.error(f"Directory not found: {r_dir}")
        else:
            reverted, errors = rollback_manifest(tmp_path, r_dir)
            if reverted > 0:
                st.success(f"Successfully reverted {reverted} files.")
            if errors:
                st.error("Some files could not be reverted:")
                for e in errors:
                    st.write(f"- {e}")
        tmp_path.unlink(missing_ok=True)

st.divider()
with st.expander("Create a validation profile", expanded=False):
    st.caption("New here? Build a validation profile JSON without hand-editing the file.")
    with st.form("profile_wizard"):
        wizard_name = st.text_input("Profile name", value="my_lab")
        wizard_experiment_types = st.text_input(
            "Allowed experiment types (comma-separated)",
            value="CT, G1G2, G1G2G3",
        )
        wizard_markers = st.text_input(
            "Allowed markers (comma-separated)",
            value="ARL, GFP, DAPI, SOX",
        )
        wizard_sample_pattern = st.text_input("Sample pattern (regex)", value=r"^E\d{2}$")
        wizard_magnification_pattern = st.text_input(
            "Magnification pattern (regex)", value=r"^X\d{2,3}$"
        )
        wizard_notes_pattern = st.text_input("Notes pattern (regex)", value=r"^[A-Za-z0-9_-]+$")
        wizard_unknown_marker_policy = st.selectbox(
            "Unknown marker policy", ["warn", "allow", "block"]
        )
        wizard_extraction_mask = st.text_input(
            "Filename extraction mask (optional)",
            value="",
            help=(
                "If your existing filenames already encode fields, describe the layout — "
                "e.g. {date}_{exptype}_{sample}_{magnification}. Used for images whose "
                "embedded metadata was stripped. Placeholders: date, exptype, sample, "
                "magnification, markers, notes. The whole filename must match, or the "
                "mask is ignored for that file."
            ),
        )
        wizard_save_path = st.text_input("Save path", value="profiles/my_lab.json")

        if st.form_submit_button("Create profile"):
            try:
                experiment_types = [
                    item.strip() for item in wizard_experiment_types.split(",") if item.strip()
                ]
                markers = [item.strip() for item in wizard_markers.split(",") if item.strip()]
                profile = ProfileRules(
                    name=wizard_name,
                    allowed_experiment_types=experiment_types,
                    allowed_markers=markers,
                    sample_pattern=wizard_sample_pattern,
                    magnification_pattern=wizard_magnification_pattern,
                    notes_pattern=wizard_notes_pattern,
                    unknown_marker_policy=wizard_unknown_marker_policy,
                    filename_extraction_mask=wizard_extraction_mask.strip() or None,
                )
                save_profile(Path(wizard_save_path), profile)
                st.success(f"Saved profile to {wizard_save_path}")
            except Exception as exc:
                st.error(f"Could not save profile: {exc}")
