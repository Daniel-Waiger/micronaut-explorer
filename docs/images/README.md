# Screenshots

Reference screenshots of Micronaut Planner, captured against the shipped
example study (the oregano-plasma-coating wound-healing study, opened via
Study map's own "Open the example study" action -- see
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
| `08-measurement-design.png` | Measurement → Samples & design (`#/measurement`) | Measurement -- Samples & design: the comparison groups, the conditions derived from them, and the controls the planner suggests with its reason for each. |
| `09-measurement-dataplan.png` | Measurement → Data plan (`#/measurement`) | Measurement -- Data plan: the filename convention, its generated preview names, and the planner checks that guard them. |
| `10-settings-storage.png` | Settings (`#/settings`) | Settings -- project backup download/import and the storage controls that manage locally saved versions. |
| `11-overview-controls.png` | Review → a measurement's Controls (`#/overview`) | Review -- the controls the planner suggests for a measurement, split into panel-derived and readout-specific, each with the reason it is suggested. |

## How the study is seeded

The capture script loads the app fresh, clicks Study map's real "Open the
example study" button (the same one a visitor would click -- it finds
whichever of that action's two variants is on screen by its `data-action`
marker), and waits for its confirmation toast to clear. This is the app's own shipped example data
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

`11-overview-controls.png` needs the same treatment for a different reason:
each measurement's entry on Review is a collapsed `<details>`, and the
Controls block lives inside one, so the script opens them before scrolling --
otherwise the target is `display: none` and there is nothing to capture.

Anything with a `scroll_to` selector is positioned by measuring the app's
sticky chrome and scrolling the target just below it. That chrome is a *stack*
of sticky bars (header, study summary, measurement switcher), each pinned at
its own offset below the one above, so the measurement takes the lowest edge
of everything pinned near the top -- measuring only the topmost bar parks the
target behind the other two.

For `04-measurement-acquisition.png`, the script expands the Acquisition
section's collapsed accordions (Fluorophores and spillover, Spectral view,
Panel assembly) and clicks "Seed from markers field", which builds the
structured fluorophore-channel table from the same seeded markers field
(`SYTO9-PROPIDIUM IODIDE`).
