# Planner web — spectral visualization and filter overlays

Status: **complete and locally verified** on `codex/fluorophore-expansion`; uncommitted and unpushed pending Daniel's approval.

## Outcome

The Color panel shows normalized schematic emission curves at their physically fixed wavelength positions, with optional user-entered center/bandwidth detection filters overlaid. Structured channels can be reordered by drag/drop, accessible move controls, or a stable “order by emission wavelength” action. Filter settings and channel order persist and flow into study documents and bench cards.

## Scientific contract

The current KB contains excitation/emission peaks, not measured curve points. Therefore this wave uses a single data-driven draft FWHM to draw normalized Gaussian **schematics**. The visual is explanatory, not a quantitative bleed-through calculation, and cannot replace actual vendor spectra, instrument transmission curves, detector response, or empirical controls. Filter bands are never guessed: users must enter their microscope’s center/bandwidth values.

Dragging changes list/acquisition order only. It never changes a dye’s wavelength or curve. Unrecognized, ambiguous-family, no-intrinsic-spectrum, and spectrum-unavailable states remain explicit and do not silently acquire curves.

## Integration boundaries

Claude’s current work is confined to LLM proposal/paste handling and a planned number-typed Nyquist question. This wave does not touch those files. Shared gates are limited to `realKb()` loading the changed spectra pack, global top-level symbol uniqueness, and a small isolated spectral CSS block in `app.css` that may need mechanical merge with Claude’s committed Wave C CSS.

## Verification focus

- Gaussian peak/FWHM mathematics and malformed-input totality.
- No invented filter defaults; partial/invalid filters do not render.
- Stable ordering: known emissions ascending, unresolved channels stable at the end.
- Drag/drop, keyboard moves, and sort all persist the same channel array shape.
- Existing free-text fallback, five-state resolution, review warning, proximity flags, and bench-card peak propagation remain unchanged.
- Responsive accessible SVG, light/dark rendering, no page overflow, no unsafe HTML interpolation.
- Full test/build gates plus an independent adversarial verification pass.

## Deliberately deferred

- Measured excitation/emission curve ingestion from authoritative datasets.
- Instrument, laser, dichroic, detector-QE, and filter-set profiles.
- Quantitative spillover matrices, compensation/unmixing, and automated panel optimization.
- Long-pass/notch/multiband filters and spectral-detector binning.

The authoritative task details and dependencies are in `planner-web-spectral-visualization-task-graph.json`.

## Final verification

- 123 affected tests and 622 full web tests passed.
- 343 non-reader Python tests passed with the 10 parked BioIO/metadata-reader integrations deselected.
- 24 single-file build tests passed.
- The final built artifact was produced twice byte-identically at 562,223 bytes, SHA-256 `da062a7557f10950a8534a5aa9251caa62d6db3e44dd5e44da5a7ce817b41846`, with zero exact lowercase runtime `fetch(` calls.
- Built-artifact interaction checks covered curve/filter rendering, two saved filters, arrow reordering, wavelength sorting, reload persistence, and dark mode.
- Both independent frontier verifier dispatches stalled in service and were closed. Per CMA lesson 42, the named fixed local adversarial loop was substituted and disclosed: re-read exact task contracts; inspect producer/consumer paths and unsafe-DOM/collision surfaces; run affected, full web, non-reader Python, and build suites; build twice; inspect the shipped artifact; and rerun after the resulting legend fix.
- The local pass found and fixed `SV-D1`: each filter band now has a color-associated legend row naming its channel and exact center/bandwidth, including unresolved-channel bands.
- Live review found and fixed `SV-D2`: structured channel inputs/selects now use explicit theme surfaces, high-contrast text and placeholders, accent focus rings, disabled styling, and matching native `color-scheme` in both dark and light modes.
