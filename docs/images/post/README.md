# Post / social snapshots

Seeded screenshots meant as "appetizer" images alongside a written post —
shots of the app doing something, as opposed to the neutral reference screens
in `../README.md`.

## Regenerating

```bash
python3 tools/capture_post_snapshots.py   # post-01 .. post-10, in-app screens
python3 tools/capture_artifact_images.py  # post-11, post-12, generated text
```

(Same Chromium requirement as the reference capture: set `CHROME_BIN` if it
isn't at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. `--only <name>`
on the first script regenerates a subset.)

## Set one — the colour panel (`post-01` .. `post-03`)

Seeds a fluorophore panel into the example study's **Macrophage cytoskeleton**
measurement.

| File | Seeded panel | Shows |
| --- | --- | --- |
| `post-01-spillover-flagged.png` | `DAPI-GFP-ALEXA FLUOR 488-CY3` | Four resolved channels and two spillover flags: emission peaks 12 nm apart (error) and excitation peaks 7 nm apart (warning). |
| `post-02-spillover-clean.png` | `DAPI-ALEXA FLUOR 488-CY3-ALEXA FLUOR 647` | The same measurement with the green channel resolved — no conflicts, plus the schematic emission curves and per-channel filter bands. |
| `post-03-dataplan.png` | `DAPI-ALEXA FLUOR 488-CY3-ALEXA FLUOR 647` | The planned filenames the finished design generates, placeholders labelled as placeholders. |

Every fluorophore was checked to resolve to state `known` through the app's
own resolver (`web/src/engine/spectra.js`'s `resolvePanel`) before being used
— no shot contains an `unrecognized` chip a reader would mistake for a typo.
All are `reviewStatus: source-cited` in `spectra.json` except GFP
(`claude-drafted`, badged `unreviewed` in the first image — the app being
honest about its own content). The flagged panel is a mistake people
actually make: a GFP line immunostained with an Alexa Fluor 488 secondary.

## Set two — the planner (`post-04` .. `post-10`)

The colour panel draws spectra, which plenty of other tools also do. The
planner — turning a plain-language description into decisions, and carrying
those decisions through to filenames, controls and a verdict — is the part
nothing else does. These walk that path, all against the shipped example
study (the oregano-derived plasma-polymer coating wound-healing study).

| File | Screen | Shows |
| --- | --- | --- |
| `post-04-brief-typed.png` | Research brief (`#/describe`) | A study description typed in, before review. |
| `post-05-brief-proposals.png` | Research brief, after Review | Four suggestions, each with the exact matched text and an explicit Accept — nothing written until a person says yes. |
| `post-06-brief-accepted.png` | Research brief, after accepting one | A suggestion's row now reads "Already confirmed" instead of offering Accept. |
| `post-07-decisions.png` | Review (`#/overview`) | Every open decision the planner can see, grouped by tier and linked back to the step that owns it. |
| `post-08-chrome.png` | Measurement (`#/measurement`) | The app chrome: header, workflow compass, measurement switcher. |
| `post-09-review-verdict.png` | Review | The pass/fail verdict, the export menu, and the "Copy prompt for your own LLM" / "Print" buttons. |
| `post-10-review-diagram.png` | Review | The study as a generated diagram: question → measurements → readout → modality → design → controls → filenames. |

### The demo description

```
We stained CTL and OPP-coated coverslips with DAPI-PHALLOIDIN to visualize nuclei
and F-actin at 40x, n = 3 biological replicates per group, imaged on 2026-09-09.
```

Written so the deterministic free-text parser (`web/src/engine/freetext.js`
`parseFreeText`) matches all four things it can ever extract — markers,
replicate count, magnification, an ISO date — verified by running the real
parser against it before use, not by inspection. That check caught a real
bug in an earlier draft: a sentence containing the word "magnification"
right before the date let the keyword-anchored magnification regex read
digits out of `2026-09-09` and propose `X202`. The wording above avoids the
word "magnification" entirely and relies on the trailing-`x` form (`40x`)
instead, which has no such hazard.

`post-04`–`post-06` target the **Scratch / migration** measurement specifically:
it's the one measurement in the example study left with no seeded
magnification and markers set to the `NONE` sentinel, so all four
suggestions start genuinely actionable rather than showing "Already
confirmed" from the first frame (three of the four measurements already
seed a magnification that matches the demo text's `40x`).

## Set three — generated artefacts (`post-11`, `post-12`)

Two outputs the app produces but never displays: the bench card downloads as
a `.md` file, and "Copy prompt for your own LLM" writes straight to the
clipboard. Screenshotting a download or a clipboard write isn't possible
without lying about what's on screen, so instead `tools/render_artifacts.mjs`
calls the app's own `renderBenchCard`/`renderLlmPrompt` engine modules
against the example study, and `tools/capture_artifact_images.py` drops the
real output into a plain local page that states outright what it is (not a
screen in the app) before photographing it.

| File | Content |
| --- | --- |
| `post-11-benchcard.png` | The full bench card for the example study's Intracellular ROS measurement — chosen because it's the one of the four with every channel resolved (real Ex/Em on both DCF and DAPI) and the fullest control set (4). Its acquisition date is filled in with today's date before rendering (`tools/render_artifacts.mjs`) the same way an unanswered date input defaults in the app, so the filenames don't lead with the `1970-01-01` placeholder. |
| `post-12-llm-prompt.png` | The prompt's instruction preamble in full, the first few lines of its JSON, then — skipping the rest of the JSON, noted as cut — the "Decisions this plan has not made yet" and "Questions to consider" sections, which is the part worth showing. |
