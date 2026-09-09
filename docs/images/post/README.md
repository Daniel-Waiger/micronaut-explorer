# Post / social snapshots

Seeded screenshots meant as "appetizer" images alongside a written post —
shots of the app doing something, as opposed to the neutral reference screens
in `../README.md`.

Regenerate with:

```bash
python3 tools/capture_post_snapshots.py
```

(Same requirements as the reference capture: set `CHROME_BIN` if Chromium
isn't at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. `--only
<name>` regenerates a subset.)

All three start from the shipped example study, switch to its
**Macrophage cytoskeleton** measurement (the confocal immunofluorescence one),
and type a fluorophore panel into its Markers field.

| File | Seeded panel | Shows |
| --- | --- | --- |
| `post-01-spillover-flagged.png` | `DAPI-GFP-ALEXA FLUOR 488-CY3` | Four resolved channels and two spillover flags: emission peaks 12 nm apart (error) and excitation peaks 7 nm apart (warning). |
| `post-02-spillover-clean.png` | `DAPI-ALEXA FLUOR 488-CY3-ALEXA FLUOR 647` | The same measurement with the green channel resolved — no conflicts, plus the schematic emission curves and per-channel filter bands. |
| `post-03-dataplan.png` | `DAPI-ALEXA FLUOR 488-CY3-ALEXA FLUOR 647` | The planned filenames the finished design generates, placeholders labelled as placeholders. |

## Why these fluorophores

An appetizer image only works if a microscopist recognises what they are
looking at immediately, so every token here is a standard multi-colour-panel
reagent rather than a specialist one: DAPI as the nuclear counterstain,
Alexa Fluor 488 / GFP in the green channel, Cy3 in the orange-red, Alexa
Fluor 647 in the far-red.

Each was checked to resolve to state `known` through the app's own resolver
(`web/src/engine/spectra.js`'s `resolvePanel` over `web/kb/markers.json` and
`web/kb/spectra.json`) before being used, so no shot contains an
`unrecognized` chip that a reader would take for a typo. All of them carry
`reviewStatus: source-cited` in `spectra.json` except GFP, which is
`claude-drafted` and is badged `unreviewed` in the first image — that badge is
the app telling the truth about its own content and is fine to show.

The flagged panel is a mistake people actually make, not an invented one: a
GFP-expressing line immunostained with an Alexa Fluor 488 secondary.
