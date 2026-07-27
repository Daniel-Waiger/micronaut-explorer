from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from microscopy_naming_assistant import metadata as metadata_module
from microscopy_naming_assistant.metadata import (
    _extract_acquisition_date,
    _extract_from_mask,
    _extract_magnification,
    _extract_markers,
    _extract_near_key,
    _extract_sample,
    _is_placeholder_channel,
    _join_within_budget,
    extract_metadata,
    extract_metadata_detailed,
)


def test_extract_markers_word_boundary_avoids_false_positive() -> None:
    result = _extract_markers("this is SCFPX region", [])
    assert result is None or "CFP" not in result.split("-")


def test_extract_markers_normalizes_alias_to_canonical() -> None:
    result = _extract_markers("stained with Alexa Fluor 488 and DAPI", [])
    assert result is not None
    markers = result.split("-")
    assert "ALEXA488" in markers
    assert "DAPI" in markers


def test_extract_markers_matches_real_token() -> None:
    result = _extract_markers("channel: GFP", [])
    assert result is not None
    assert "GFP" in result.split("-")


def test_extract_markers_orders_by_first_match_position() -> None:
    assert _extract_markers("DAPI then GFP", []) == "DAPI-GFP"


def test_extract_from_mask_keeps_the_final_field_intact() -> None:
    fields = _extract_from_mask("2025-01-02_CT_E03", "{date}_{exptype}_{sample}")
    assert fields == {"date": "2025-01-02", "exptype": "CT", "sample": "E03"}


def test_extract_from_mask_requires_a_full_match() -> None:
    # Stem has an extra trailing segment the mask doesn't describe: the file
    # doesn't follow the convention, so parse nothing rather than half of it.
    assert _extract_from_mask("2025-01-02_CT_E03_extra", "{date}_{exptype}_{sample}") == {}


def test_extract_from_mask_ignores_unknown_placeholder() -> None:
    assert _extract_from_mask("2025-01-02_CT", "{date}_{operator}") == {}


def test_bare_x_magnification_is_off_by_default() -> None:
    # "512 x 512" in a metadata dump is an image size, not a magnification.
    assert _extract_magnification("SizeX 512 x 512 pixels", []) is None


def test_bare_x_magnification_parses_filename_stem_when_enabled() -> None:
    assert _extract_magnification("embryo 3 x 93 gfp", [], allow_bare_x=True) == "X93"


def test_extract_sample_reads_spelled_out_embryo() -> None:
    assert _extract_sample("embryo 3 gfp", []) == "E03"


def test_stripped_metadata_tif_falls_back_to_filename_keywords(tmp_path: Path) -> None:
    file_path = tmp_path / "embryo_3_x_93_GFP_DAPI.tif"
    file_path.write_bytes(b"dummy")

    metadata = extract_metadata(file_path, timeout_seconds=5)

    assert metadata["sample"] == "E03"
    assert metadata["magnification"] == "X93"
    assert set(metadata["markers"].split("-")) == {"GFP", "DAPI"}


def test_extraction_mask_overrides_filename_heuristics(tmp_path: Path) -> None:
    file_path = tmp_path / "2025-01-02_CT_E07.tif"
    file_path.write_bytes(b"dummy")

    metadata = extract_metadata(
        file_path, timeout_seconds=5, extraction_mask="{date}_{exptype}_{sample}"
    )

    assert metadata["date"] == "2025-01-02"
    assert metadata["exptype"] == "CT"
    assert metadata["sample"] == "E07"


@pytest.mark.parametrize("name", ["Channel:0:0", "Channel 1", "C0", "channel_2", "3"])
def test_placeholder_channel_names_are_rejected(name: str) -> None:
    assert _is_placeholder_channel(name)


@pytest.mark.parametrize("name", ["GFP", "DAPI", "Alexa Fluor 488", "SOX yellow"])
def test_real_channel_names_are_kept(name: str) -> None:
    assert not _is_placeholder_channel(name)


def test_acquisition_date_is_read_from_metadata() -> None:
    assert _extract_acquisition_date("AcquisitionDate = 2025-02-03T11:22:33") == "2025-02-03"


def test_acquisition_date_ignores_impossible_values() -> None:
    assert _extract_acquisition_date("AcquisitionDate = 2025-99-99") is None


def test_acquisition_date_absent_returns_none() -> None:
    assert _extract_acquisition_date("ImageJ=1.54f images=210 channels=3") is None


@pytest.mark.parametrize(
    ("text", "key", "expected"),
    [
        # Vendors write compound key names our hint is only a prefix of.
        ("ObjectiveName = HC PL APO 93x", "Objective", "HC PL APO 93x"),
        ("ExperimentName = CT_electroporation", "Experiment", "CT_electroporation"),
        # Plain and XML-attribute forms must keep working.
        ('NominalMagnification="93"', "NominalMagnification", "93"),
        ("Channel: GFP", "Channel", "GFP"),
    ],
)
def test_extract_near_key_handles_vendor_key_shapes(text: str, key: str, expected: str) -> None:
    assert _extract_near_key(text, key) == expected


def test_metadata_sections_all_survive_truncation() -> None:
    # One verbose section must not crowd every later section out of the blob.
    sections = ["=== a ===\n" + "x" * 50_000, "=== b ===\nObjectiveName = 93x", "=== c ===\nend"]
    blob = _join_within_budget(sections, 5_000)

    assert len(blob) <= 5_100
    assert "=== a ===" in blob
    assert "ObjectiveName = 93x" in blob
    assert "=== c ===" in blob


def _write_imagej_tif(path: Path, info: str) -> None:
    """Write a TIFF that stashes vendor metadata in the ImageJ `Info` tag.

    This is the shape ImageJ/Fiji produces on export: the rich acquisition
    record lives in the IJMetadata tag, while bioio's `.metadata` shows only the
    structural `ImageJ=...` header.
    """
    numpy = pytest.importorskip("numpy")
    tifffile = pytest.importorskip("tifffile")
    tifffile.imwrite(
        str(path),
        numpy.zeros((3, 8, 8), "uint8"),
        imagej=True,
        metadata={"Info": info, "channels": 3},
    )


@pytest.mark.integration
def test_imagej_info_block_is_read_when_bioio_metadata_is_bare(tmp_path: Path) -> None:
    # Regression: bioio's `.metadata` for this file is only the ImageJ header,
    # so everything below was previously invisible and the name came out UNKNOWN.
    path = tmp_path / "stripped.tif"
    _write_imagej_tif(
        path,
        "ExperimentName = CT_electroporation\n"
        "NominalMagnification = 93\n"
        "ChannelName #0 = GFP green\n"
        "ChannelName #1 = DAPI blue\n"
        "AcquisitionDate = 2025-02-03T11:22:33\n"
        "StagePosition = embryo 3\n",
    )

    fields = extract_metadata(path, timeout_seconds=60)

    assert fields["magnification"] == "X93"
    assert fields["sample"] == "E03"
    assert fields["date"] == "2025-02-03"
    assert set(fields["markers"].split("-")) >= {"GFP", "DAPI"}


@pytest.mark.integration
def test_detailed_extraction_reports_reader_and_raw_metadata(tmp_path: Path) -> None:
    from microscopy_naming_assistant.metadata import extract_metadata_detailed

    path = tmp_path / "detail.tif"
    _write_imagej_tif(path, "ObjectiveName = HC PL APO 93x\n")

    _fields, _sources, detail = extract_metadata_detailed(path, timeout_seconds=60)

    assert detail.reader
    assert not detail.timed_out
    assert "HC PL APO 93x" in detail.metadata_text


class _SyncProcess:
    """Runs `target(*args)` synchronously in-process instead of spawning.

    A real `multiprocessing.get_context("spawn").Process` re-imports this
    module in a fresh interpreter, so a `monkeypatch.setattr` on
    `metadata._read_with_bioio` in the test process would never reach the
    child. Running the target inline keeps the monkeypatch effective and the
    fast-suite tests below fast (no process spawn, no JVM/bioio startup).
    """

    def __init__(self, target, args) -> None:
        self._target = target
        self._args = args

    def start(self) -> None:
        self._target(*self._args)

    def join(self, timeout: float | None = None) -> None:
        return None

    def is_alive(self) -> bool:
        return False

    def terminate(self) -> None:
        return None

    def kill(self) -> None:
        return None


class _SyncContext:
    def Queue(self):
        import queue as queue_module

        return queue_module.Queue()

    def Process(self, target, args):
        return _SyncProcess(target, args)


def _patch_synchronous_bioio(monkeypatch, bioio_payload: dict) -> None:
    """Bypass the real spawn+bioio path with a synchronous fake payload."""
    monkeypatch.setattr(metadata_module.multiprocessing, "get_context", lambda kind: _SyncContext())
    monkeypatch.setattr(
        metadata_module,
        "_read_with_bioio",
        lambda file_path, field_key_map=None: bioio_payload,
    )


_EMPTY_BIOIO_PAYLOAD = {
    "fields": {},
    "metadata_text": "",
    "reader": "fake-reader",
    "error": "",
    "key_paths": {},
    "field_key_provenance": {},
    "images": [],
}


def test_mtime_sourced_date_is_tagged_mtime_not_filename(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A5: when nothing else supplies a date, the mtime fallback must carry
    its own "mtime" tag rather than being folded into "filename" -- mtime is
    frequently the date the file was *copied*, not acquired.
    """
    _patch_synchronous_bioio(monkeypatch, _EMPTY_BIOIO_PAYLOAD)

    # Stem has no date-shaped substring, so nothing but mtime can supply one.
    file_path = tmp_path / "sampleE03_run.tif"
    file_path.write_bytes(b"dummy")
    dt = datetime(2020, 6, 15, 8, 0, 0)
    import os

    os.utime(file_path, (dt.timestamp(), dt.timestamp()))

    fields, sources, _detail = extract_metadata_detailed(file_path, timeout_seconds=5)

    assert fields["date"] == "2020-06-15"
    assert sources["date"] == "mtime"
    assert sources["date"] != "filename"


def test_filename_sourced_date_is_tagged_filename_and_wins_over_mtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A5: a date parsed out of the filename stem is a stronger guess than
    mtime and must keep the distinct "filename" tag, not "mtime".
    """
    _patch_synchronous_bioio(monkeypatch, _EMPTY_BIOIO_PAYLOAD)

    file_path = tmp_path / "2021-03-04_sample.tif"
    file_path.write_bytes(b"dummy")
    # mtime deliberately disagrees with the filename date, so a passing
    # assertion on fields["date"] proves the filename value actually won.
    dt = datetime(2020, 6, 15, 8, 0, 0)
    import os

    os.utime(file_path, (dt.timestamp(), dt.timestamp()))

    fields, sources, _detail = extract_metadata_detailed(file_path, timeout_seconds=5)

    assert fields["date"] == "2021-03-04"
    assert sources["date"] == "filename"
    assert sources["date"] != "mtime"


def test_metadata_sourced_date_is_unaffected_by_the_mtime_tag_split(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A5: real acquisition metadata must still override the mtime/filename
    heuristics and keep the "metadata" tag -- splitting "filename" into
    "filename"/"mtime" must not touch this path.
    """
    _patch_synchronous_bioio(
        monkeypatch,
        {
            **_EMPTY_BIOIO_PAYLOAD,
            "fields": {"date": "2025-02-03"},
            "metadata_text": "AcquisitionDate = 2025-02-03T11:22:33",
        },
    )

    # Filename and mtime both disagree with the metadata date, so a passing
    # assertion proves metadata actually won, not that it happened to match.
    file_path = tmp_path / "2099-12-31_sample.tif"
    file_path.write_bytes(b"dummy")
    dt = datetime(2020, 6, 15, 8, 0, 0)
    import os

    os.utime(file_path, (dt.timestamp(), dt.timestamp()))

    fields, sources, _detail = extract_metadata_detailed(file_path, timeout_seconds=5)

    assert fields["date"] == "2025-02-03"
    assert sources["date"] == "metadata"


@pytest.mark.integration
def test_extract_metadata_fallback_includes_date_and_sample_guess(tmp_path: Path) -> None:
    file_path = tmp_path / "run_E3_trial.tif"
    file_path.write_bytes(b"dummy")

    dt = datetime(2025, 1, 2, 3, 4, 5)
    ts = dt.timestamp()
    file_path.touch()
    import os

    os.utime(file_path, (ts, ts))

    metadata = extract_metadata(file_path)

    assert metadata["date"] == "2025-01-02"
    assert metadata["sample"] == "E03"
