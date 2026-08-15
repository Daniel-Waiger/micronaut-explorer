# Open tasks — Micronaut Planner

Last updated: 2026-08-13

> **Draft — Claude-authored from ROADMAP + git history; Daniel to confirm/reprioritize.**
> Authoritative scope for any listed item lives in its plan doc under `docs/plans/`.
> `ROADMAP.md` holds the long-range "why"; this file is just the near-term worklist.
>
> The old contents of this file (the Classic "Review Remediation" execution plan) are
> **done** — that work shipped. Micronaut Classic (`src/`, `app_streamlit.py`) is now
> **parked: not going forward in the near term**; all work is on the web Planner. The old
> plan is archived at `_archive/docs/TASKS-classic-review-remediation.md` if needed.

## Near-term

- **Alpha-pilot-readiness is done, minus two loose ends only Daniel can close:**
  1. Fill in `FEEDBACK_FORM_URL` / `FEEDBACK_EMAIL` in `web/src/ui/shell.js` (a Google
     Form and a non-personal email — **not** a GitHub `@users.noreply` address, which
     discards incoming mail) so the two feedback links actually appear in the header.
     The "Copy feedback report" button and the GitHub issues link already work with no
     setup.
  2. Everything under "Content authoring" below (the `web/kb/spectra.json` review in
     particular — it grew substantially this pass).
- Once those are set, the app is ready to widen the pilot. Nothing else is queued —
  the entire roadmap is shipped except the in-app LLM seam, which is deliberately last
  (see ROADMAP.md's "Next").

## Recently shipped (2026-08-12 – 2026-08-13, alpha-pilot-readiness, Waves 0–2)

### Wave 0 — review fixes
- **Color panel engine fixes** (`engine/spectra.js`): two different colors of the same
  fluorophore family (e.g. MitoTracker Green + Deep Red) no longer collapse into one
  entry; hyphenated aliases (`calcein-am`, `fura-2`, `texas-red`, …) are now reachable via
  a rejoin pass over `splitMarkers`'s output; the app's own "no markers" sentinels
  (`NONE`, `N/A`, `unstained`, …) render as a declaration, not a typo; spillover flags sort
  severity-first; a peak-plausibility guard (300–900 nm, emission > excitation) catches a
  hand-edit typo in `spectra.json` before it ships.
- **Color panel UI**: per-state row coloring; "not yet reviewed by Daniel" → "by a
  microscopy specialist" (the app is public).
- **KB content**: `SYTO`/`DCFDA` families added (the default study's own `SYTO9`/`DCF`
  markers were previously unrecognized); `BODIPY`/`CELLMASK`/`ER-TRACKER` converted to
  real per-color families; `SOX`/`SOX2` reclassified from the `dye` default to a new
  `target` class (antibody targets, not dyes); a ~20-entry common-dye sweep; `ARL`/`RFP`/
  `FURA2` deliberately left as honest content gaps (unclear identity / heterogeneous /
  ratiometric — not oversights).
- **Controls engine fix** (`engine/controls.js` + `web/kb/controls.json`): every
  panel-kind control rule used to share one predicate, so isotype-control and
  secondary-antibody-only-control fired on every panel regardless of whether an antibody
  was involved. `engine/spectra.js`'s `derivePanelFacts` computes
  `panel.derived.{fluorophoreCount,hasAntibody,hasTag,hasMarkersDeclared}`; a new
  biological-specificity-control rule and a new FMO rule (fires at `fluorophoreCount >=
  3`) were added. Verified against the real default study: no assay gets an antibody
  control it shouldn't.
- **Ship integrity**: `deploy.yml` now runs the build pipeline's own pytest suite and a
  post-build artifact smoke check before publishing. `tools/serve_dir.py` regenerates a
  stale `web/kb.dev.js` on startup, and now sends `Cache-Control: no-store` — a stale
  browser-cached ES module produced two false "export not found" scares during this pass.
- **Cleanups**: CSV formula-injection guard; four download buttons collapsed to one
  helper; `web/tests/fixtures.js` extracted.

### Wave 1 — feedback path
- "Copy feedback report" header button (`core/feedbackReport.js` + `ui/clipboard.js`,
  extracted from `ui/steps/naming.js`'s copy-button so there's one clipboard
  implementation, not two): step, browser, KB issue count, full study as text.
- A GitHub issues link; a Google Form / email link, wired but blank pending Daniel (see
  "Near-term" above).

### Wave 2 — the rest of the roadmap, minus the LLM seam
- **Structured panel assembly** (`engine/panelAssembly.js`, `ui/steps/panel.js`): the
  long-reserved `panel.channels` is now a real editor — target, fluorophore, conjugation
  mode (antibody-direct / antibody-indirect / genetically-encoded / direct-probe /
  tag-ligand). A "Seed from markers field" button bootstraps it from the free-text field
  once. `engine/studydoc.js` prefers a filled-in `panel.channels` over the free-text
  derivation once any channel exists — verified live: switching one channel to
  antibody-indirect on the default study adds 3 controls on Overview.
- **Bench card export** (`engine/render/benchcard.js`): a compact, print-oriented
  single-assay Markdown summary — channels (with resolved ex/em), controls with their
  reasons, condition count, two worked filenames. One button per assay on Overview.
  `engine/studydoc.js` grew a `panelRows` array (per-assay channel list, structured-or-
  free-text, same precedence as above) to back it.
- **Conformance check** (`engine/conformance.js`): one pass/fail verdict for the whole
  study, composed from `conditionIssues`, `validateFields` (against a profile now shared
  with `ui/steps/naming.js` via `engine/validation.js`'s exported `DEFAULT_PROFILE`,
  rather than two copies), `validateTargetPath`, `flagPanelOverlaps`, and
  `studyNameIssues`. Deliberately does NOT use Classic's `profiles/facsi_default.json` —
  that's a separate Python-side, per-lab content surface, not something to port into the
  Planner uninvited. Splits "answered but invalid" (fails the gate) from "not answered
  yet" (a warning, does not fail) — an early version conflated the two and failed the
  shipped default study on its own placeholder text. Surfaced on Overview above the
  per-assay tree.
- **"Export for your own LLM"** (`engine/render/llmprompt.js`): a "Copy prompt for your
  own LLM" button on Overview — ground rules (never invent a marker/setting, say what's
  missing) + the study as JSON (byte-identical to the "Download raw data" export) +
  suggested questions. Zero network calls, no API key — the model is on the other side of
  a copy-paste, so it cannot write back into the study.
- A real duplicate-top-level-symbol build break (`assayLabel` in two files) surfaced by
  the Wave 0 deploy-gate addition, fixed by exporting one copy from `studydoc.js`.

## Content authoring (owned by Daniel, not code)

Lives in the knowledge pack (`web/kb/`); see the K-1…K-7 list and the parked review of
`web/kb/advisor.json` wording in [ROADMAP.md](ROADMAP.md). `web/kb/spectra.json` grew
substantially across Wave 0 (still Claude-drafted, still flagged unreviewed in-app) —
now the highest-priority review target given how much of it is new.

## Later (see ROADMAP for full phase list)

- LLM seam (in-app providers): manual-paste, then opt-in Ollama + diagnostics — explicitly
  last, after the pilot.
