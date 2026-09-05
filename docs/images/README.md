# Screenshots

Reference screenshots of Micronaut Planner, captured against the shipped
example study (the oregano-plasma-coating wound-healing study, opened via
Study map's own "Open the example study" link -- see
`web/src/core/defaultStudy.js`). All images are 1440px wide, light theme
except the last.

Regenerate all of them with:

```bash
python3 tools/capture_screenshots.py
```

(Set `CHROME_BIN` if Chromium isn't at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` on your machine. Pass
`--only <name>[,<name>...]` to regenerate a subset; see
`python3 tools/capture_screenshots.py --help`.)

| File | Screen | Suggested caption |
| --- | --- | --- |
| `01-study-map.png` | Study map (`#/home`) | Study map -- the shipped example study's shape at a glance. |
| `02-research-brief.png` | Research brief (`#/describe`) | Research brief -- the study narrative, plus the deterministic free-text parser suggesting structured fields from a description. |
| `03-measurements-registry.png` | Measurements registry (`#/study`) | Measurements registry -- every measurement in the example study, searchable and filterable. |
| `04-measurement-acquisition.png` | Measurement → Acquisition (`#/measurement`) | Measurement -- Acquisition panel with fluorophore channels seeded from the markers field, spillover check, and the spectral overlap view. |
| `05-overview-review.png` | Review (`#/overview`) | Review -- the whole study's readiness, its diagram, and its exports in one screen. |
| `06-guide.png` | Guide (`#/guide`) | Guide -- searchable in-app reference for every term and step. |
| `07-overview-dark.png` | Review (`#/overview`), dark theme | Review screen in dark theme. |

## How the study is seeded

The capture script loads the app fresh, clicks Study map's real "Open the
example study" link (the same one a visitor would click), and waits for its
confirmation toast to clear. This is the app's own shipped example data
(`web/src/core/defaultStudy.js`), not a fabricated or hand-edited payload --
re-running the script reproduces the exact same study deterministically.

For `02-research-brief.png`, the free-text "Study description" box is
otherwise empty by default (the example study seeds structured fields like
specimen/markers/magnification, but not this separate narrative field), so
the script types one sentence that only restates facts already present in
the seeded "Bacterial viability" measurement (its real organism, marker, and
magnification values) before clicking "Review description" -- this
demonstrates the deterministic free-text parser without inventing any new
scientific claim.

For `04-measurement-acquisition.png`, the script expands the Acquisition
section's collapsed accordions (Fluorophores and spillover, Spectral view,
Panel assembly) and clicks "Seed from markers field", which builds the
structured fluorophore-channel table from the same seeded markers field
(`SYTO9-PROPIDIUM IODIDE`).
