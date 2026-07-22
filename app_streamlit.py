from __future__ import annotations

from pathlib import Path
import tempfile

import streamlit as st

from microscopy_naming_assistant.service import apply_batch, plan_batch, suggest_for_file


st.set_page_config(page_title="Microscopy Naming Assistant", page_icon="🔬", layout="wide")
st.title("Microscopy Naming Assistant")
st.caption("Preview and apply naming-convention renames with optional profile validation.")

st.sidebar.header("Settings")
config_path = Path(st.sidebar.text_input("Config path", value="naming_scheme.json")).expanduser()
profile_input = st.sidebar.text_input("Profile path (optional)", value="profiles/facsi_default.json").strip()
profile_path = Path(profile_input).expanduser() if profile_input else None
use_llm = st.sidebar.checkbox("Use Ollama suggestions", value=False)
strict = st.sidebar.checkbox("Strict validation", value=True)
pattern = st.sidebar.text_input("Glob pattern", value="*.tif")

st.subheader("Folder Mode (Preview + Apply)")
folder_input = st.text_input("Input folder path", value="")

if st.button("Preview Renames"):
    if not folder_input:
        st.error("Provide an input folder path.")
    else:
        input_dir = Path(folder_input).expanduser()
        if not input_dir.exists():
            st.error(f"Folder does not exist: {input_dir}")
        elif not config_path.exists():
            st.error(f"Config not found: {config_path}")
        elif profile_path is not None and not profile_path.exists():
            st.error(f"Profile not found: {profile_path}")
        else:
            batch = plan_batch(
                input_dir=input_dir,
                pattern=pattern,
                config_path=config_path,
                use_llm=use_llm,
                profile_path=profile_path,
                strict=strict,
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
    if not config_path.exists():
        st.error(f"Config not found: {config_path}")
    elif profile_path is not None and not profile_path.exists():
        st.error(f"Profile not found: {profile_path}")
    else:
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
