# planner-web — the color panel (qualitative spectral-spillover advisor)

Status: **planned, implementation starting 2026-08-02.** Planned via an Opus planning
pass (CMA scheme, full path per the master decision rule — scope was not well-defined
going in). Daniel confirmed two open questions before implementation: reuse
`naming.fields.markers` as the panel's data source (not the long-reserved, never-built
`panel.targets`/`panel.channels`), and proceed with the proposed ~35–40-entry v1 content
scope.

## Context

`ROADMAP.md`'s "Next" list: *"Fluorophore / color panel to minimize spectral spillover —
its own page, rules qualitative-first (no spectral-overlap integrals yet). Not started."*
`web/kb/markers.json` has ~90 fluorophore/marker canonical ids with aliases, but zero
spectral data — this feature adds that data and a qualitative pairwise check over it.

Per Daniel's explicit instruction, spectral content is **Claude-drafted, flagged for
review** — the same arrangement already used for `web/kb/advisor.json`'s 16 rules — not
a placeholder and not something left for Daniel to author from scratch.

## Architecture decisions

1. **One source of truth: `naming.fields.markers`.** The panel is a pure read over the
   free-text markers field the Naming step already populates, parsed with
   `engine/validation.js`'s existing `splitMarkers` (not a second regex). This avoids the
   lesson-49/50 shape (two places asserting "which fluorophores are in this assay" that
   can drift). `panel.targets`/`panel.channels` (reserved since schema v1, zero
   consumers) stay untouched — reserved for a possible future, fuller panel-assembly
   feature, not repurposed here.
2. **Qualitative rule = peak-proximity, not banding or laser-line snapping.** Two
   independent checks over excitation/emission peak nanometers already being drafted:
   `emissionProximityNm` (default 25 nm, severity `error` — typical emission
   bandpass/FWHM widths mean peaks this close substantially co-register regardless of
   filter choice) and `excitationProximityNm` (default 20 nm, severity `warning` —
   standard laser lines are spaced far enough apart that peaks this close will both be
   excited by one line, which is exactly what the existing `confocal-sequential-scanning`
   advisor rule already tells users to solve with sequential scanning). Both thresholds
   live in the KB as data (tagged `claude-drafted`), not hardcoded engine constants —
   they're a domain judgment call pending review against FACSI's actual filter sets
   (`K-3`, not yet authored), same as the peak values themselves.
3. **Spectral family-hood is independent of naming family-hood.** `markers.json` marks
   MitoTracker/LysoTracker/Sytox/GCaMP as `isFamily`; `spectra.json` encodes its own
   `isFamily` per entry since GCaMP's variants share one chromophore/spectrum (differ in
   kinetics, not color) while MitoTracker's four color variants genuinely differ
   optically. Family entries carry per-variant sub-entries only where variants really
   differ.
4. **Computed flags reuse the existing `{field, message, severity}` issue shape** and the
   `.issues-list`/`.issue-{severity}` CSS idiom already used four times in this codebase —
   not a new advice-note card. The existing static advisor tips (`advice.js`) stay a
   separate, unchanged mechanism, just extended to a new `'panel'` surface.
5. **Five-state per-token resolution**, never a boolean known/unknown, mirroring
   `readoutState`'s never-silent discipline: `unrecognized` (no alias match — likely
   typo), `ambiguous-family` (resolves to a family canonical but not to a specific listed
   variant — cannot check spillover without knowing which color), `no-intrinsic-spectrum`
   (a tag/moiety like HaloTag/SNAP/phalloidin — spillover depends on the conjugate dye,
   not the tag), `spectrum-unavailable` (a real, recognized dye/protein just not yet
   drafted — an honest content gap), `known` (full peaks available, participates in the
   pairwise check). Every state renders a specific sentence — never a blank row, never a
   silently-shrunk pairwise scan with no comment about what was excluded.
6. **New step, `createPanelStep(kb)`**, matching the `createDescribeStep`/
   `createOverviewStep` factory convention, inserted between Naming and Overview in
   `main.js`'s step list. A persistent, non-dismissible review banner (new — no prior
   in-app convention existed; `ROADMAP.md`'s "⚠ Parked review" bullet was doc-level only)
   states the content is Claude-drafted and not yet Daniel-reviewed, plus a per-row
   "unreviewed" badge.

## v1 content scope

~35–40 well-documented entries already in `markers.json`: the Alexa Fluor series, the
ATTO series, DAPI/Hoechst/FITC/Texas Red/Cy dyes, common fluorescent proteins
(GFP/YFP/CFP/mCherry/tdTomato/mNeonGreen/mScarlet/…), a few SiR dyes, MitoTracker's four
color variants. **Deliberately excluded as honest content gaps, not guessed:** BODIPY
(near-zero info in the bare family name), RFP (heterogeneous, not one protein), Fura-2
(ratiometric — two excitation peaks depending on Ca²⁺ state, doesn't fit a single-peak
model), ARL/SOX/SOX2/CellMask/ER-Tracker (no confident standard single-peak value). Every
excluded-but-real marker resolves to `spectrum-unavailable`, visibly.

## Files

**New:** `web/kb/spectra.json`, `web/src/engine/spectra.js`, `web/src/ui/steps/panel.js`,
`web/tests/spectra.test.js`.

**Modified:** `web/src/engine/kbpack.js` (thread `spectra` through `shapeAppKb`, expose
`markersKb`), `web/src/engine/advisor.js` (`ADVICE_SURFACES` +`'panel'`),
`web/kb/advisor.json` (one rule's `surfaces` +`"panel"`), `web/src/main.js` (register the
step), `web/src/ui/steps/guide.js` (one bullet), `web/styles/app.css` (small class block),
`web/tests/kbpack.test.js`/`advisor.test.js` (coverage), `ROADMAP.md`/`TASKS.md` (status).

## Deferred, non-blocking

Surfacing a per-assay flagged-pair summary on the Study Overview step (mirroring the
Controls sub-tree) — batched after v1 ships, same posture as the assay-tier plan's
commit 4 being deliberately last.

## Verification

`node --test web/tests/*.test.js` and `.venv/Scripts/python.exe -m pytest -q -m "not
integration"` green, zero regressions. `tools/build_single_file.py --out dist/` succeeds,
stays under the 2 MB gate. Verified live against the **built artifact** (lessons 47/48 —
never trust `file://`/dev-server-only verification): empty markers field states that
plainly; `ALEXA488,GFP` resolves both `known` with an `error`-severity flag citing the
actual nm gap; a nonsense token resolves `unrecognized`; bare `MITOTRACKER` resolves
`ambiguous-family`; review banner and per-row badges visible and accurate. Opus
adversarial pass mandatory per the master decision rule, hunting specifically: a
never-fires rule (the `[*]`-wildcard predicate.js trap), HTML/data disagreement, an empty
list rendering as silence, overstated certainty in the review-banner wording.
