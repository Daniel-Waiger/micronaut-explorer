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
