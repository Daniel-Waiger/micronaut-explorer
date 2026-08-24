# Spectral channel filter synchronization

## Goal

Make the structured channel editor and the spectral plot consume the same
filter decision: a known fluorophore with no saved filter pair must still
plot its emission-derived suggestion, and selecting a different library dye
must replace a stale pair with that new suggestion.

## Task SP-1 — synchronize defaults and structural updates

- **Files:** `web/src/engine/panelAssembly.js`, `web/src/ui/steps/panel.js`,
  `web/src/ui/spectralView.js`, `web/tests/panelAssembly.test.js`
- **Ground truth:** the channel-row inputs already display
  `defaultChannelFilterPair(emissionPeakNm)` when no complete pair is saved,
  but `resolvedChannelEntry()` previously sent only stored values to the
  spectral renderer. A library picker change re-rendered the row but retained
  an old persisted pair.
- **Implementation:** centralize the effective pair in the panel assembly
  engine; use it for structured spectrum entries; clear a channel’s pair only
  for a discrete library selection. Free-text typing stays non-structural and
  retains focus.
- **Adversarial verification:** prove a null stored pair yields an immediate
  filter, prove a structural dye change clears only its own old pair, retain
  a deliberate complete pair when no reset was requested, build `dist`, and
  run the full JavaScript suite.

## Verification result

The targeted tests and full suite passed (815 tests). The built artifact
contains the effective-filter and structural-reset paths and no static import.
An Opus/Fable verification pass is not available in this environment, so the
fixed local adversarial loop was used and recorded in the CMA dashboard.
