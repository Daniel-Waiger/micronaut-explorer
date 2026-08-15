# Fluorophore expansion handover

Date: 2026-08-14  
Owner: Codex/gpt-5.6-sol-medium  
Worktree: `G:\My Drive\FACSI\Image Analysis\github-desktop-repos\micronaut-codex`  
Branch: `codex/fluorophore-expansion`  
Remote: `origin/codex/fluorophore-expansion`

## Outcome

The Planner fluorophore expansion is complete, independently CMA-verified, committed,
and pushed. It adds 72 exact direct fluorophore canonicals and 11 family variants, backed
by an 83-record source ledger. The generated marker KB now has 168 canonicals and no
normalized alias collisions. The runtime spectra pack, resolver, study-document rows,
bench-card output, and built single-file artifact all consume the expanded data.

Two commits contain the work:

- `a2f7bd34c27c5392a05b3a451e8618aa4ac369f3` —
  `feat(planner-web): expand fluorophore coverage`
- `32fa097832103a1dffdf5e05c647d9c811f1bbc7` —
  `fix(streamlit): avoid nested metadata expanders`

Both commits carry `Agent: Codex/gpt-5.6-sol-medium`. Local and remote HEAD were verified
equal at `32fa097832103a1dffdf5e05c647d9c811f1bbc7` before this handover update.

## What changed

- Added the authoritative reference ledger at
  `docs/references/planner-fluorophore-sources.json`.
- Added 72 canonical identities and aliases in
  `src/microscopy_naming_assistant/markers.py`.
- Added class assignments and 11 family variants in `tools/export_markers_kb.py`.
- Regenerated `web/kb/markers.json` and expanded `web/kb/spectra.json`.
- Kept new spectra at `reviewStatus: claude-drafted`; the persistent review warning
  remains intentional.
- Preserved generic FP parents and explicit unsupported states such as FURA2's
  `spectrum-unavailable` result.
- Fixed punctuation-equivalent family resolution so `LIVE-DEAD Near IR` resolves the
  exact `livedead near ir` spectrum rather than degrading to `ambiguous-family`.
- Added complete producer, source-parity, resolver, pack-wiring, study-document, and
  bench-card regression coverage. Consumer tests mutate runtime KB peaks in memory, so
  they fail if downstream code hard-codes spectral values.
- Fixed the Streamlit metadata preview crash by replacing the outer metadata expander
  with a bordered container while retaining the four tier expanders and a separate raw
  metadata expander.
- Made the download-button smoke assertion compatible with both Streamlit 1.37.1 and
  1.61.1 through `AppTest.get("download_button")`.

## Verification record

- Marker/export Python tests: 40 passed.
- Full non-reader Python suite: 343 passed, 10 reader-integration tests deselected.
- Streamlit smoke suite: 15 passed on supported-floor Streamlit 1.37.1 and 15 passed on
  current Streamlit 1.61.1.
- Full web suite: 608 passed.
- Single-file build tests: 24 passed.
- Marker exporter run twice with byte-identical outputs.
- `dist/index.html` rebuilt successfully; final local build hash was
  `4484ddc02eac3342836e3a092bb3b16d667756d9f03368989ceef9cad1e05a9c`.
- Static artifact inspection confirmed required marker/spectrum records, draft-review
  state, and no runtime `fetch()` calls.
- Independent CMA verifier approved the final implementation with no blocking findings.
- `git diff --check` and Black formatting checks passed.

`web/kb.dev.js` and `dist/index.html` are generated but ignored by Git. They were verified
locally and are not remote branch artifacts; the tracked producer/KB inputs reproduce them.

## Integration notes for Claude

This branch was created from `feat/alpha-pilot-readiness` at `bb0fbd9`, not from `main`.
Do not rebase it onto `main`. The feature branch later advanced through `abf4f90` and
`83ade5c`.

The safest integration choices are to merge `codex/fluorophore-expansion` into the current
feature branch or cherry-pick `a2f7bd3` followed by `32fa097`. There is no substantive
overlap with Claude's Wave C files. A likely textual conflict exists in
`tools/cma-dashboard/index.html` because both branches updated their own embedded dashboard
snapshot. Resolve that file by choosing the dashboard state intended for the receiving
branch and regenerating it with `tools/cma-dashboard/update.py`; do not hand-edit its
embedded snapshot.

No pull request was opened.

## Decisions and invariants to preserve

- `web/kb/questions.json` was not changed; constrained-decoding enums are unaffected.
- Exact product/protein variants remain distinct from generic family identities.
- DiR's exact `dir` alias remains available for structured lookup but excluded from
  free-text matching.
- Family variants remain peak-only in the runtime spectra schema; measurement contexts
  live in the source ledger.
- Spectra plausibility remains 300–900 nm with emission greater than excitation.
- Overlap thresholds remain data-driven at 25 nm emission and 20 nm excitation.
- Ratiometric, multi-state, and photoconvertible probes that cannot be represented by one
  honest pair remain out of scope.
- BioIO and metadata-reader work are explicitly parked by Daniel. The local ignored
  `.venv` created during verification is intentionally lightweight and has no BioIO. If
  reader work resumes, install the full reader environment before trusting reader tests.
- Never load pixel data when reader work resumes.

## Unfinished and open questions

- A microscopy specialist still needs to review the 83 source-backed records and decide
  when to remove `claude-drafted`; source verification is not local experimental
  validation against FACSI filters and instruments.
- `ROADMAP.md` and `TASKS.md` still describe the earlier Wave 0 `~20-entry` spectra growth.
  They should be updated after integration to reflect this 72-direct/11-variant increment,
  while retaining the parked specialist-review warning. Neither file was edited because
  they are on the coordination coupling list and were outside the approved task ownership.
- Automated browser control was blocked by the browser's localhost URL policy. HTTP 200,
  static artifact inspection, build tests, and downstream runtime tests passed, but a
  human visual smoke check of the served artifact remains useful after integration.
- Decide whether to merge/cherry-pick directly or open a pull request from the pushed
  branch.

## Next steps

1. Integrate the two commits into the current `feat/alpha-pilot-readiness` line without
   rebasing onto `main`.
2. Resolve/regenerate the dashboard snapshot if that file conflicts.
3. Rerun `node --test web/tests/*.test.js` and
   `python -m pytest -q tests/test_single_file_build.py` on the integrated branch.
4. Rebuild the single-file artifact from tracked inputs.
5. Update `ROADMAP.md`/`TASKS.md` after Daniel confirms the new catalog wording.
6. Schedule microscopy-specialist review of the source ledger and spectra pack.
