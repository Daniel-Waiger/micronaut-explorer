"""Shared, non-test helpers for the AppTest UI smoke suite (test_app_smoke.py).

Deliberately named without a ``test_`` prefix so pytest never collects this
module as a test file itself -- it only supplies fixtures-by-convention to
``test_app_smoke.py``.

Every helper here exists to make ``app_streamlit.py`` safe to drive under
``streamlit.testing.v1.AppTest``: no real Ollama HTTP traffic, no real bioio
metadata extraction (no pixel data ever loaded), and no config file written
into the repo working tree.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import streamlit as st
from streamlit.testing.v1 import AppTest

from microscopy_naming_assistant.metadata import ExtractionDetail

# Derived from parents[1] (tests/ -> repo root), never hard-coded, so this
# keeps resolving correctly regardless of where the repo checkout lives.
APP_PATH = Path(__file__).resolve().parents[1] / "app_streamlit.py"

# The six naming fields every naming_scheme.json config defines by default
# (config.NamingConfig.defaults / field_map.MAPPABLE_FIELDS). Sourcing all
# six as "metadata" means a fresh preview never reports anything under
# "needs review" by default, matching a well-behaved real extraction.
_STUB_BASE_FIELDS: dict[str, str] = {
    "date": "2024-01-01",
    "exptype": "CT",
    "sample": "E01",
    "magnification": "X40",
    "markers": "DAPI-GFP",
    "notes": "STUB",
}


def _stub_extract_metadata_detailed(
    file_path: Path,
    timeout_seconds: int = 20,
    extraction_mask: str | None = None,
    field_key_map: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict[str, str], ExtractionDetail]:
    """Fast, deterministic stand-in for metadata.extract_metadata_detailed.

    Varies the `notes` field by a short stable hash of the input filename's
    stem so distinct input files never render to the same planned target
    name. An identical-fields stub would make every previewed file collide
    on the same target name and exercise the suffix-conflict-resolution path
    (service._resolve_distinguishing_suffix_collision) instead of the
    ordinary strictly-1:1 planning path this harness exists to protect.
    """
    token = hashlib.sha1(file_path.stem.encode("utf-8")).hexdigest()[:6].upper()
    fields = dict(_STUB_BASE_FIELDS)
    fields["notes"] = f"{fields['notes']}-{token}"
    sources = {key: "metadata" for key in fields}

    key_paths = {
        "Image/ObjectiveName": fields["magnification"],
        "Image/AcquisitionDate": fields["date"],
    }
    field_key_provenance = {
        "magnification": "Image/ObjectiveName",
        "date": "Image/AcquisitionDate",
    }
    # Two per-image records so any test exercising the per-series sidecar
    # (build_series_rows) has real multi-image content to work with.
    images = [
        {"index": "0", "name": f"{file_path.stem} - Series 1", **fields},
        {"index": "1", "name": f"{file_path.stem} - Series 2", **fields},
    ]
    detail = ExtractionDetail(
        metadata_text=(
            f"[stub metadata for {file_path.name}]\nObjectiveName: {fields['magnification']}"
        ),
        reader="stub-reader",
        error="",
        timed_out=False,
        key_paths=key_paths,
        field_key_provenance=field_key_provenance,
        images=images,
    )
    return dict(fields), dict(sources), detail


class _BlockedOrRecordedCall:
    """Replacement for `requests.get`/`requests.post` inside llm.py.

    Records the call into `recorder` (a list supplied by the caller) when
    one was given; otherwise raises, so a test that forgets to pass a
    `request_recorder` fails loudly instead of silently reaching the network.
    """

    def __init__(self, method: str, recorder: list[dict[str, Any]] | None) -> None:
        self._method = method
        self._recorder = recorder

    def __call__(self, url: str, **kwargs: Any) -> Any:
        if self._recorder is None:
            raise AssertionError(
                f"blocked outbound requests.{self._method}({url!r}) -- boot_app() was not "
                "given a request_recorder, so no test may reach the network."
            )
        self._recorder.append({"method": self._method, "url": url, "kwargs": kwargs})
        response = MagicMock(name=f"requests.{self._method}-response")
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {}
        return response


def boot_app(
    monkeypatch: Any,
    tmp_path: Path,
    *,
    models: Sequence[str] = ("llama3",),
    extraction: (
        Callable[..., tuple[dict[str, str], dict[str, str], ExtractionDetail]] | None
    ) = None,
    request_recorder: list[dict[str, Any]] | None = None,
) -> AppTest:
    """Boot app_streamlit.py under AppTest with every real-world side effect
    neutralized, then run it once and return the resulting AppTest.

    - config_path defaults to the bare relative "naming_scheme.json", so cwd
      is switched to `tmp_path` FIRST -- the app must create/rewrite it there
      and never in the repo working tree.
    - the 60s-ttl Ollama model-list cache (`_cached_ollama_models`) is
      cleared so a stale model list from an earlier test/run can never leak.
    - `llm.list_local_ollama_models` and `service.extract_metadata_detailed`
      are monkeypatched so no test needs a running Ollama server or a real
      bioio-readable file.
    - `llm.requests.get`/`.post` are monkeypatched so no test can ever reach
      the real network, whether or not it means to exercise the LLM path.
    """
    monkeypatch.chdir(tmp_path)

    st.cache_data.clear()

    monkeypatch.setattr(
        "microscopy_naming_assistant.llm.list_local_ollama_models",
        lambda endpoint, timeout_seconds=2: list(models),
    )

    monkeypatch.setattr(
        "microscopy_naming_assistant.service.extract_metadata_detailed",
        extraction or _stub_extract_metadata_detailed,
    )

    monkeypatch.setattr(
        "microscopy_naming_assistant.llm.requests.get",
        _BlockedOrRecordedCall("get", request_recorder),
    )
    monkeypatch.setattr(
        "microscopy_naming_assistant.llm.requests.post",
        _BlockedOrRecordedCall("post", request_recorder),
    )

    at = AppTest.from_file(str(APP_PATH), default_timeout=30)
    at.run()
    return at


def make_files(directory: Path, names: Iterable[str]) -> list[Path]:
    """Write tiny placeholder byte stubs (never real pixel data -- extraction
    is always monkeypatched via `boot_app`) and return their Paths."""
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in names:
        p = directory / name
        p.write_bytes(b"II*\x00stub-not-a-real-image")
        paths.append(p)
    return paths


def preview(at: AppTest, folder: Path) -> AppTest:
    """Type `folder` into the folder-path input and click "Preview Renames",
    then run the app once so the preview takes effect."""
    at.text_input(key="folder_input_path").set_value(str(folder))
    preview_button = next(b for b in at.button if b.label == "Preview Renames")
    preview_button.click()
    return at.run()
