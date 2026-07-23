from __future__ import annotations

from pathlib import Path

# Add src to sys.path so we can run directly
import sys
src_path = Path(__file__).parent / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

import os
import tempfile

# ── Force upload limit to 10 GB (overrides the 200 MB default) ──
# Environment variables are the lightest way to set Streamlit config;
# they are read once during import with zero per-rerun overhead.
os.environ.setdefault("STREAMLIT_SERVER_MAX_UPLOAD_SIZE", "10240")   # 10 GB
os.environ.setdefault("STREAMLIT_SERVER_MAX_MESSAGE_SIZE", "10240")  # 10 GB

import streamlit as st

from microscopy_naming_assistant.config import default_config, load_config, save_config
from microscopy_naming_assistant.llm import list_local_ollama_models
from microscopy_naming_assistant.service import apply_batch, plan_batch, suggest_for_file


st.set_page_config(page_title="Microscopy Naming Assistant", page_icon="🔬", layout="wide")
st.title("Microscopy Naming Assistant")
st.caption("Preview and apply naming-convention renames with optional profile validation.")

st.sidebar.header("Settings")
config_path = Path(st.sidebar.text_input("Config path", value="naming_scheme.json")).expanduser()

if not config_path.exists():
    config_path.parent.mkdir(parents=True, exist_ok=True)
    save_config(config_path, default_config())
    st.sidebar.info(f"Created default config at {config_path}")

config = load_config(config_path)

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

use_llm = st.sidebar.checkbox("Use Ollama suggestions", value=bool(config.llm.get("enabled", False)))

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
    st.sidebar.warning("No local Ollama models detected. The app will safely continue without LLM enrichment.")

profile_input = st.sidebar.text_input("Profile path (optional)", value="profiles/facsi_default.json").strip()
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
save_config(config_path, config)

st.subheader("Folder Mode (Preview + Apply)")
folder_input = st.text_input("Input folder path", value="")
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
    
    with_issues = [s for s in suggestions if s.issues]
    
    if with_issues:
        st.warning(f"⚠️ {len(with_issues)} files have validation issues. Please fix the missing or invalid fields below:")
        
        data = []
        for s in with_issues:
            row = {"_source": str(s.source.name)}
            row.update(s.fields)
            data.append(row)
            
        edited_df = st.data_editor(data, num_rows="fixed", use_container_width=True)
        
        if st.button("Re-validate & Update Fields"):
            from microscopy_naming_assistant.naming import build_filename, normalize_fields
            from microscopy_naming_assistant.validation import validate_fields
            from microscopy_naming_assistant.profiles import load_profile
            
            profile = load_profile(profile_path) if profile_path else None
            
            for row, s in zip(edited_df, with_issues):
                new_fields = {k: v for k, v in row.items() if k != "_source"}
                s.fields = normalize_fields(new_fields, config)
                s.target_name = build_filename(s.source, s.fields, config)
                if profile:
                    s.issues = validate_fields(s.fields, profile)
                else:
                    s.issues = []
            st.rerun()

    from microscopy_naming_assistant.service import recalculate_batch
    batch = recalculate_batch(input_dir, suggestions, strict, conflict_strategy)

    st.write("### Planned Renames")
    table_rows = [{"source": src.name, "suggested": dst.name} for src, dst in batch.planned]
    st.dataframe(table_rows, use_container_width=True)

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
st.caption("Upload files to preview names. For safety, this mode does not modify original source files.")
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
            for file_obj in uploaded:
                tmp_path = tmp_dir / file_obj.name
                tmp_path.write_bytes(file_obj.getbuffer())
                result = suggest_for_file(
                    file_path=tmp_path,
                    config_path=config_path,
                    use_llm=use_llm,
                    profile_path=profile_path,
                    llm_model_override=llm_model,
                )
                preview_rows.append(
                    {
                        "source": file_obj.name,
                        "suggested": result.target_name,
                        "issues": "; ".join(
                            [f"{i.severity}:{i.field}" for i in result.issues]
                        ),
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
        from microscopy_naming_assistant.manifest import rollback_manifest
        import tempfile
        
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
