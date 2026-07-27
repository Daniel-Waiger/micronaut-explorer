"""Drop-in fixture tests for per-format metadata extraction.

These exist so that dropping a real sample file into `tests/data/` (see
`tests/data/README.md`) immediately activates a real, format-specific
extraction test with no other wiring needed. Until a fixture for a given
format is present, that format's case is skipped (not failed) via
`pytest.mark.skipif`; the whole test is additionally marked `integration` so
it never runs as part of the fast default suite (`pytest -q -m "not
integration"`).

Unlike the original P2-2 scaffold (which targeted per-format
`_extract_structured_*` stubs), these assert against the extractor main
actually ships: `extract_metadata_detailed`, whose `ExtractionDetail.key_paths`
is the harvested key/value map (see `metadata_keys.harvest` +
`field_map.resolve_fields`). A populated `key_paths` with no read error is the
real proof the file was read, not just that a dict came back.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import microscopy_naming_assistant.metadata as metadata_module
from microscopy_naming_assistant.metadata import extract_metadata_detailed

DATA_DIR = Path(__file__).parent / "data"

_FIXTURES = [
    ("ome-tiff", DATA_DIR / "sample.ome.tif"),
    ("czi", DATA_DIR / "sample.czi"),
    ("lif", DATA_DIR / "sample.lif"),
    ("nd2", DATA_DIR / "sample.nd2"),
]


@pytest.mark.integration
@pytest.mark.parametrize(
    "fixture_path",
    [
        pytest.param(
            path,
            id=format_id,
            marks=pytest.mark.skipif(
                not path.exists(),
                reason=f"tests/data/{path.name} fixture not present (see tests/data/README.md)",
            ),
        )
        for format_id, path in _FIXTURES
    ],
)
def test_extraction_reads_the_file(fixture_path: Path) -> None:
    """Prove extraction runs end-to-end and actually reads each format's fixture.

    Skipped (not failed) until the corresponding fixture in `tests/data/` is
    added -- see `tests/data/README.md`. Once a fixture exists, this asserts the
    harvest path produced key/value metadata without a reader error or timeout.
    Tighten the per-format assertions (known channels/magnification) against
    ground truth once you know the fixture's expected values.
    """
    fields, sources, detail = extract_metadata_detailed(fixture_path, timeout_seconds=60)

    assert isinstance(fields, dict)
    assert isinstance(sources, dict)
    assert detail.error == "", f"reader error: {detail.error}"
    assert detail.timed_out is False, "extraction timed out"
    # The whole point of the addressable-metadata refactor: the file's metadata
    # was harvested into an addressable key->value map. An empty map means the
    # reader saw nothing (or the file was not really read).
    assert detail.key_paths, "no metadata keys harvested -- was the file actually read?"
    # TODO: once this fixture's ground truth is known, assert specific values,
    # e.g. the expected channel/marker names appear in fields["markers"] and the
    # objective magnification resolved correctly. See tests/data/README.md.


class _SyncProcess:
    """Runs `target(*args)` synchronously in-process instead of spawning.

    Mirrors the harness in tests/test_metadata.py: a real
    `multiprocessing.get_context("spawn").Process` re-imports the metadata
    module fresh in a child interpreter, so a `monkeypatch.setattr` on
    `metadata_module._read_with_bioio` in the test process would never reach
    it. Running the target inline keeps the fake payload effective and the
    test fast (no process spawn, no bioio/JVM startup) -- which is exactly
    what T5's test needs: a controlled multi-image payload flowing through
    the SAME `q.get()` -> `ExtractionDetail` reconstruction code the real
    spawned worker's payload flows through.
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


def _patch_synchronous_bioio(monkeypatch: pytest.MonkeyPatch, payload: dict) -> None:
    """Bypass the real spawn+bioio path with a synchronous fake payload."""
    monkeypatch.setattr(metadata_module.multiprocessing, "get_context", lambda kind: _SyncContext())
    monkeypatch.setattr(
        metadata_module,
        "_read_with_bioio",
        lambda file_path, field_key_map=None: payload,
    )


def test_image_key_paths_covers_every_image_and_matches_key_paths_for_first(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T5: `image_key_paths` must carry one raw key dict per image (not just
    the first, which is all `key_paths` ever held), stay index-aligned so
    `image_key_paths[0] == key_paths`, and keep a key's per-series difference
    (e.g. `Magnification` varying across a container's series) visibly
    different across the list -- this is the whole discrimination axis B-2's
    ranker depends on, and it was previously unmeasurable because only the
    first image's keys ever reached `SuggestionResult`.
    """
    payload = {
        "fields": {"magnification": "X40"},
        "metadata_text": "synthetic multi-image harvest",
        "reader": "fake-reader",
        "error": "",
        "key_paths": {"Magnification": "40", "SeriesName": "Series 1"},
        "image_key_paths": [
            {"Magnification": "40", "SeriesName": "Series 1"},
            {"Magnification": "63", "SeriesName": "Series 2"},
            {"Magnification": "63", "SeriesName": "Series 3"},
        ],
        "field_key_provenance": {"magnification": "Magnification"},
        "images": [],
    }
    _patch_synchronous_bioio(monkeypatch, payload)

    file_path = tmp_path / "multi_series.lif"
    file_path.write_bytes(b"dummy")

    _fields, _sources, detail = extract_metadata_detailed(file_path, timeout_seconds=5)

    assert len(detail.image_key_paths) == 3, "expected one raw key dict per image"
    assert (
        detail.image_key_paths[0] == detail.key_paths
    ), "image 0's raw keys must match key_paths exactly (E1/T5 invariant)"
    magnifications = {d["Magnification"] for d in detail.image_key_paths}
    assert magnifications == {"40", "63"}, (
        "a key whose value differs between images must stay visibly different "
        "across image_key_paths, not be collapsed to a single value"
    )


def test_malformed_image_key_paths_payload_degrades_to_empty_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T5: `image_key_paths` crosses the multiprocessing spawn Queue, so the
    parent's reconstruction of it from the raw payload dict must never raise
    on a malformed shape (non-dict entries, non-str values) -- it must
    degrade defensively to the empty-list default instead.
    """
    payload = {
        "fields": {},
        "metadata_text": "",
        "reader": "fake-reader",
        "error": "",
        "key_paths": {},
        "image_key_paths": [{"ok": "fine"}, "not-a-dict", {"bad": 123}],
        "field_key_provenance": {},
        "images": [],
    }
    _patch_synchronous_bioio(monkeypatch, payload)

    file_path = tmp_path / "malformed.lif"
    file_path.write_bytes(b"dummy")

    _fields, _sources, detail = extract_metadata_detailed(file_path, timeout_seconds=5)

    assert detail.image_key_paths == []
