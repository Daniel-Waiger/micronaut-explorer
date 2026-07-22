from __future__ import annotations

from pathlib import Path
import tempfile

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
installed = list_local_ollama_models(endpoint=llm_endpoint, timeout_seconds=5)

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
pattern = st.sidebar.text_input("Glob pattern", value="*.tif")

config.llm["enabled"] = use_llm
config.llm["model"] = llm_model
config.llm["endpoint"] = llm_endpoint
config.llm["timeout_seconds"] = llm_timeout
config.llm["preferred_models"] = preferred
save_config(config_path, config)

st.subheader("Folder Mode (Preview + Apply)")
folder_input = st.text_input("Input folder path", value="")

if st.button("Preview Renames"):
    if not folder_input:
        st.error("Provide an input folder path.")
    else:
        input_dir = Path(folder_input).expanduser()
        if not input_dir.exists():
            st.error(f"Folder does not exist: {input_dir}")
        else:
            batch = plan_batch(
                input_dir=input_dir,
                pattern=pattern,
                config_path=config_path,
                use_llm=use_llm,
                profile_path=profile_path,
                strict=strict,
                llm_model_override=llm_model,
            )

            st.session_state["planned"] = [(str(src), str(dst)) for src, dst in batch.planned]
            table_rows = [{"source": src.name, "suggested": dst.name} for src, dst in batch.planned]
            st.session_state["table_rows"] = table_rows
            st.session_state["skipped"] = batch.skipped
            st.session_state["issues"] = [
                {
                    "source": s.source.name,
                    "severity": issue.severity,
                    "field": issue.field,
                    "message": issue.message,
                }
                for s in batch.suggestions
                for issue in s.issues
            ]

if "table_rows" in st.session_state:
    st.write("Planned renames")
    st.dataframe(st.session_state["table_rows"], use_container_width=True)

    if st.session_state.get("skipped"):
        st.warning("Skipped items")
        for item in st.session_state["skipped"]:
            st.write(f"- {item}")

    if st.session_state.get("issues"):
        st.info("Validation issues")
        st.dataframe(st.session_state["issues"], use_container_width=True)

    if st.button("Apply Renames", type="primary"):
        planned = [(Path(src), Path(dst)) for src, dst in st.session_state.get("planned", [])]
        renamed = apply_batch(planned)
        st.success(f"Renamed {renamed} files.")

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
