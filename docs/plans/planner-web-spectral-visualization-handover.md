# Handover — spectral visualization and filter overlays

Date: 2026-08-15
Branch: `codex/fluorophore-expansion`
Base/current published tip before this wave: `c4d4289` (branched from `feat/alpha-pilot-readiness`, never `main`)
State: implementation and frontier verification complete. Daniel explicitly authorized the final merge after the synchronized feature branch passed independent review; this record accompanies the normal fast-forward publication to both the feature branch and `main`.

## Delivered

- The Color panel now renders normalized Gaussian **schematic** emission curves at fixed physical wavelength positions over 300–900 nm.
- Optional user-entered detection filters persist as center/bandwidth nanometers and render as translucent bands associated with their channel.
- The schematic width is data-driven through `overlapRules.schematicEmissionFwhmNm` with a backwards-compatible 50 nm fallback. It is explicitly described as a draft global width, not measured spectra.
- Structured channels can be reordered by drag/drop, keyboard-accessible up/down buttons, or a stable **Order by emission wavelength** action. Known emissions sort ascending; unresolved channels retain their relative order at the end.
- Filter values and saved channel order propagate through study-document panel rows and the bench-card Detection filter column. Missing or malformed filters render explicitly as not set; no instrument filter is invented.
- The SVG uses DOM/SVG construction only, includes an accessible title/description, labels and line styles in addition to color, an empty state, responsive sizing, and light/dark theme tokens.
- Every fluorophore curve and detection-filter band is mouse- and keyboard-interactive. Hover/focus emphasizes the active element, dims peers, shows a named tooltip/details card (for example **SYTO9**), and exposes synchronized `aria-pressed` state.
- Curves and filters can be turned on/off independently from either the SVG element or its persistent legend button. Enter and Space toggle focused SVG data; native legend buttons preserve standard keyboard behavior. Visibility survives renderer refreshes during filter edits but is deliberately not written into assay scientific data.
- Filter bands print the exact user-entered `center/bandwidth nm` value directly on the plot. Collision-aware lanes keep co-centered values distinct, while haloed labels, stronger axes, a status card, and explicit On/Off badges improve light/dark readability.
- Existing five-state spectrum resolution, proximity flags, free-text marker fallback, seeding, specialist-review warning, advice panel, and peak propagation remain intact.

### Fluorophore library picker extension

- The structured channel editor no longer asks users to type a known fluorophore. Its native, keyboard-accessible dropdown is generated from the normalized spectra pack and currently contains all 190 spectrum-backed choices: each non-family canonical plus each exact family variant, once.
- Every option identifies the fluorophore and its library peaks (for example `SYTO9 — Ex 480 / Em 500 nm`), in a fixed English/numeric alphabetical order.
- Free text appears only after the explicit final choice **Not in library — add new fluorophore…**. Existing custom study values reopen in that mode and remain editable.
- Existing recognized aliases reopen on the corresponding library choice without rewriting the saved value merely because the panel rendered. A user selection writes the catalog key through the existing `panel.channels` autosave path.
- Writes are mode-aware: tag-ligand channels save `conjugateDye`; every other channel mode saves `fluorophore`. The handler rereads current store state and updates by stable channel id, preserving concurrent target/filter/sibling edits and remaining correct after channel reorder.
- A producer/consumer audit found seven valid spectra canonicals that existed in the marker pack but were not indexed as aliases. `resolveMarkerToken` now accepts an exact spectra-canonical fallback, and a real-pack regression proves all 190 picker values resolve back to `known` after saving.
- The picker controls inherit the corrected dark/light field styling and add scoped labels/layout without changing other forms.

## Scientific boundary

The KB still contains peaks, not sampled excitation/emission spectra. These curves are therefore explanatory normalized Gaussian schematics. They are not a spectral-overlap integral, do not predict quantitative bleed-through, and cannot replace vendor spectra, optical-component transmission, detector response, or empirical single-stain controls. Filter bands are user-entered from the actual microscope; the app does not guess them.

## Verification record

- Affected tests: 123 passed during implementation.
- Latest focused spectral model/interaction suites: 11 passed, including hover cleanup, independent restoration, refresh persistence, malformed identities, and three co-centered filters.
- Full web suite: 626 passed.
- Fluorophore-picker extension: focused catalog/component/persistence coverage passed; full web suite is now 632/632.
- Full non-reader Python suite: 343 passed; the 10 BioIO/metadata-reader integrations remain parked and deselected exactly as Daniel requested.
- Single-file build tests: 24 passed.
- Final `dist/index.html` built twice byte-identically after the interaction fixes: 575,767 bytes, SHA-256 `dff1641966fbd3e5170908b662cb27ae450fe293a5e7a47944694e290820895d`.
- Final picker artifact built twice byte-identically: 583,393 bytes, SHA-256 `658cf6540e46cc66488f484dd740e8b66c39671bab22a469cb61a56226c929ac`; the duplicate-symbol gate and all 24 build tests pass.
- The preview served the new picker artifact successfully on five consecutive requests and again after the final build (`http://127.0.0.1:8780/`, HTTP 200, 583,393 bytes). The dashboard remains healthy on `:8778`.
- The required independent `gpt-5.6-sol` high read-only verifier returned PASS with no blocking findings. It separately exercised persistence/reorder behavior, confirmed all 190 options resolve as known (including the seven canonical fallbacks), checked the named group/controls accessibility structure, reconstructed the 55-module concatenated build, and reported no diff-check errors.
- Exact lowercase runtime `fetch(` count in the built artifact: zero. The duplicate-top-level-symbol build gate passed.
- Built-artifact browser checks passed for free-text rendering, structured channel seeding, two complete filter overlays, arrow reordering, stable wavelength sorting, filter/channel association after reordering, reload persistence, and dark mode.
- Native drag/drop is implemented over the same immutable reorder helper and has working arrow controls as an accessible fallback. The browser automation's low-level drag did not trigger HTML5 drag events, so native drag still merits a short human smoke check.
- A temporary 360 px browser viewport was applied, but localhost browser policy blocked the follow-up interaction. The override was reset. Responsive CSS has explicit 700/560/440 px behavior and no unsafe width interpolation; a human narrow-screen smoke remains useful.
- Live dark/light review after `SV-D2` verified structured text/select controls against the built artifact: dark input background `rgb(28,33,40)`, text `rgb(230,237,243)`, placeholder `rgb(139,150,165)`; light input background `rgb(255,255,255)`, text `rgb(26,32,39)`, placeholder `rgb(91,101,114)`.
- Independent verifier substitution: both `gpt-5.6-sol` high and `gpt-5.5` xhigh read-only verifier dispatches remained running without a result even after explicit conclude interrupts, so they were closed. Per CMA lesson 42, the fixed local adversarial loop was run and disclosed: exact task-contract reread, producer/consumer and unsafe-DOM/collision inspection, affected/full web/non-reader Python/build suites, deterministic shipped-artifact checks, and rerun after the one defect found. `SV-D1` was fixed by replacing the generic filter legend with per-channel center/bandwidth rows color-associated to each band.
- The interaction extension received a successful `gpt-5.6-sol` high adversarial pass after one repair cycle. The verifier reproduced two blockers: object-valued malformed identities could throw during curve sorting, and three co-centered filters reused a label lane. Identity normalization and collision-aware label allocation fixed both; the 11-test focused rerun and original adversarial reproductions passed, with no blocking findings remaining.
- The in-app browser refused the localhost reload for this final extension under its URL policy, so no alternate browser surface was used. Interaction behavior is proven through the deterministic DOM harness plus the shipped-artifact build/freshness gates; Daniel should refresh the already-open `http://127.0.0.1:8780/#/panel` tab for the final visual smoke.

## Claude spillover learned

Claude's current uncommitted lane adds the chat-LLM copy/paste proposal flow, Ollama cold-start/status work, and one number question `smallestFeature` at `acquisition.smallestFeatureNm` with an advisor rule. The new assay field is additive and does not alter `panel.channels`. The question has no options enum, so it does not expand constrained-decoding enums. His new top-level names do not collide with the `SPECTRAL_VIEW_*` / `spectralView*` namespace, and the single-file gate passes in this tree. Both lanes touch `app.css`, but Claude's chat-LLM block and this wave's isolated spectral/panel blocks are disjoint and should merge mechanically.

The remaining couplings are indirect: `realKb()` loads every KB JSON, integration must rerun the combined JS suite after Claude's `questions.json`/`advisor.json` work lands, and the concatenating build must rerun once both sets of new top-level symbols are present.

### Post-merge synchronization verification

- Fetched `origin/main` at `2127b53bbbb75dbcb88d9c12660e5e32a8756f7d`, which contains the earlier Codex expansion and Claude's merged proposal-review, chat-LLM, Ollama, validation, question/advisor, and guidance work.
- Committed this wave as `33f71b8bf961da3307d793e9af77e513090a8934`, then merged `origin/main` without rebase as `8493c993efb2b18278ab7da0e825f5aac64eba03`. Both commits carry the required Codex trailer.
- The read-only merge simulation predicted one conflict only in `tools/cma-dashboard/index.html`. The real merge matched: `web/styles/app.css` auto-merged both isolated feature blocks, and the dashboard snapshot was regenerated through `tools/cma-dashboard/update.py` rather than hand-merged.
- The combined tree passes 680/680 web tests and 45/45 Python KB/export/build tests. Five consecutive served-artifact requests contained both the fluorophore picker and Claude's chat-target code.
- The combined single-file artifact built twice byte-identically at 640,759 bytes, SHA-256 `5827c1048e42e391c67e7bf552beb91bb6d7980586f10e4445b4e5675f20eb8f`, below the 2 MiB cap and with the duplicate-top-level/static-import gates passing.
- The first post-merge verifier correctly withheld PASS because final dashboard/handover edits were still dirty and it had been asked to conclude before independently rerunning the gates; no source defect was found. After those records were committed, a fresh `gpt-5.6-sol` high verifier independently reran all 680 web and 45 Python gates, rebuilt twice at the same hash, checked merge topology/trailers/conflict markers/CSS/dashboard parsing, exercised the 190/190 picker round-trip and representative Claude/Codex paths, and returned PASS. Its normal non-force push dry-run also succeeded.
- Final publication uses a normal atomic push of one already-verified commit to `codex/fluorophore-expansion` and `main`. Because `origin/main` is an ancestor of the feature tip, this is a fast-forward with no rebase, force push, extra conflict resolution, or source change after verification.

## Files

The authoritative scope and ownership are in:

- `docs/plans/planner-web-spectral-visualization.md`
- `docs/plans/planner-web-spectral-visualization-task-graph.json`
- `docs/plans/planner-web-spectral-visualization-ownership.json`

Runtime work is in `web/kb/spectra.json`, `web/src/engine/spectralView.js`, panel/study-document/bench-card consumers, `web/src/ui/spectralView.js`, `web/src/ui/steps/panel.js`, and the isolated end block in `web/styles/app.css`. Deterministic interaction coverage is in `web/tests/spectralViewUi.test.js`.

## Still on the table

1. Optional human smoke only: native drag/drop, clipboard/chat link-outs, a real Ollama request, and the 360–440 px responsive layout.
2. Refresh the open preview and human-smoke the 190-item picker (known dye, custom dye, tag-ligand), hover/focus, curve/filter toggles, native drag, and a 360–440 px layout because localhost browser policy blocked the final automated visual pass.
3. After Claude's uncommitted wave is integrated, rerun all JS/build gates and resolve any mechanical `app.css` merge.
4. Microscopy-specialist review remains required for the prior peak ledger and the new global schematic-width wording.
5. Product follow-ons remain deliberately deferred: measured excitation/emission curves with provenance/licensing, instrument/laser/dichroic/filter/detector profiles, excitation/laser overlays, quantitative overlap matrices, compensation/unmixing guidance, filter presets, and panel optimization. An extreme panel with roughly 13+ exactly co-centered filters would also need a scrollable/dynamic-height label layout; ordinary co-centered panels are collision-tested through three bands.

## Integration sequence

1. Integrate this branch into `feat/alpha-pilot-readiness` without rebasing onto `main`.
2. Merge the disjoint `app.css` blocks and retain both dashboard snapshots only in their owning worktrees; do not copy `status.json` between agents.
3. Rerun `node --test web/tests/*.test.js`, `.venv/Scripts/python.exe -m pytest -q -m "not integration"`, and `.venv/Scripts/python.exe -m pytest -q tests/test_single_file_build.py`.
4. Build twice with `python tools/build_single_file.py`, verify identical hashes, zero exact lowercase `fetch(` calls, and size below 2 MiB.
5. Smoke the Color panel with two filters, reorder/sort/reload, then check Claude's Describe/chat-LLM flow in the same built artifact.
