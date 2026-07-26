# Test fixtures for per-format metadata extraction

This directory holds small, real sample files used only by
`tests/test_metadata_structured.py` to validate metadata extraction against
`src/microscopy_naming_assistant/metadata.py` (`extract_metadata_detailed`,
which harvests each file's metadata into an addressable key/value map via
`metadata_keys.harvest` + `field_map.resolve_fields`).

No fixtures are checked into git (they are real microscopy files and may be
too large or not freely redistributable). This directory exists so the tests
that need them can find them by a fixed, known name, and are automatically
skipped until a file shows up. `.gitkeep` keeps the otherwise-empty directory
tracked.

## Fixtures needed

Drop in one small real file per format, named exactly as below (a single
multi-channel image with a couple of Z/T planes is plenty -- these are for
metadata parsing, not pixel-data testing, so keep them small):

| File             | Format      |
|------------------|-------------|
| `sample.ome.tif` | OME-TIFF    |
| `sample.czi`     | CZI (Zeiss) |
| `sample.lif`     | LIF (Leica) |
| `sample.nd2`     | ND2 (Nikon) |

Each file should have known channel names and a known objective
magnification (write them down -- e.g. a comment in the test, or a sibling
`sample.<ext>.expected.json`) so the `# TODO` assertions in
`tests/test_metadata_structured.py` can be tightened to check the extractor's
output against ground truth.

## How the tests pick these up

`tests/test_metadata_structured.py` has one parametrized test case per
format. Each case is guarded with
`pytest.mark.skipif(not <path>.exists(), ...)`, so:

- **No fixture present (today):** the case is collected but reported as
  **skipped**, not a failure. The fast suite (`pytest -q -m "not
  integration"`) never touches these anyway, since the whole test is also
  marked `@pytest.mark.integration`.
- **Fixture dropped in:** the corresponding case starts running for real
  (`pytest -q -m integration`, or a plain `pytest -q` picks it up too). It
  asserts the file was actually read -- `extract_metadata_detailed` returns a
  populated `key_paths` map with no reader error or timeout. Tighten it with
  the fixture's real expected channels/magnification once you know them (see
  the `# TODO` in that file).

## Where this fits

No stub or per-format wiring is required. `extract_metadata_detailed` already
routes every supported format through `harvest()` -> `resolve_fields()`; a
dropped-in fixture exercises that same production path end to end.
