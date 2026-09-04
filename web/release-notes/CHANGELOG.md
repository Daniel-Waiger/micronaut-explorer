# Changelog

All notable changes to the Micronaut Planner web app are documented here.
This project uses [Semantic Versioning](https://semver.org/). Reconstructed
retroactively — see [ROADMAP.md](../../ROADMAP.md) and
[TASKS.md](../../TASKS.md) for the day-to-day worklist this app was actually
built against; the version numbers below are annotated git tags placed on
that existing history, not a scheme that was tracked from day one.

## [Unreleased]

## [0.16.0] - 2026-09-04

### Added
- A version tag on the Settings page, and this release notes page.

## [0.15.1] - 2026-09-03

### Fixed
- The walkthrough dialog no longer merges into the app's own footer.
- A missing favicon — the browser tab and bookmark icon are now set.
- Background UI interactions are blocked during the feature tour.
- The sticky footer no longer shows ghost controls through toasts, and silent
  operations no longer trigger one.
- Study groups are asked for once, on the measurement that actually uses
  them, instead of repeating the prompt.

## [0.15.0] - 2026-09-03

### Changed
- **Pilot-readiness restructure.** One front door: the onboarding modal is
  gone, the feature tour no longer starts itself, and a first run starts
  blank rather than inside the shipped example.
- Ten routes became five plus three utilities: Study map, Research brief,
  Measurements (a searchable registry), the measurement you opened, and
  Review.
- One status vocabulary reaches the user — Draft, Needs a decision, Ready to
  acquire — while conformance remains the sole export gate.
- **The LLM seam closed, not deferred.** The in-app model path was removed
  rather than finished; the one remaining path is one-way — "Copy prompt for
  your own LLM" hands the researcher a block for whatever model they already
  use, and nothing it produces is parsed back into the study.

## [0.14.0] - 2026-08-24

### Added
- An orientation step that helps researchers orient around their study plan.
- Improved feedback handoff and walkthrough.
- A collapsed theme bulb toggle for switching color mode from the nav.

### Fixed
- The guided workflow and naming inputs are usable again.
- A duplicate study map comparison prompt no longer appears.

## [0.13.0] - 2026-08-23

### Changed
- A refreshed product-designer UI.
- Contextual microscopy icons throughout the app.
- The study planning workflow was redesigned and now guides the user through
  it explicitly.
- The project description review workspace was unified into one page.

## [0.12.0] - 2026-08-18

### Added
- **Zen-planner reframe.** Home/walkthrough, a phased interview, a
  name-builder-style Microscopy grid, schedule export, and a searchable wiki.
- An onboarding stage router and local-model auto-detect.

Retired in 0.15.0, which removed the onboarding gate this introduced.

## [0.11.0] - 2026-08-16

### Added
- An interactive spectral panel and fluorophore picker.
- Expanded fluorophore coverage.
- The color panel patch: per-fluorophore colors and a default filter
  suggestion.

### Fixed
- Fluorophore-picker alignment, per-fluorophore emission-curve width, and
  filter/color defaults refreshing correctly on pick.
- The spectrum chart's height and text no longer distort as its width
  changes.
- Sticky/collapsible step nav, with full-height layout and monochrome icons.

## [0.10.0] - 2026-08-15

### Added
- **Opt-in local LLM.** Step guidance and study drafting into a fresh tab,
  via a locally running Ollama model.
- A chat-LLM round trip for zero-setup users: copy a prompt, paste the
  model's JSON back in.
- Reviewing model proposals into an in-progress study.

### Fixed
- Ollama's context is capped so a model fits in GPU VRAM, and it unloads on
  tab close.
- Validation error messages are now plain language.

Retired in 0.15.0, which closed the in-app LLM seam entirely in favor of a
one-way copy-prompt handoff.

## [0.9.0] - 2026-08-13

### Added
- **Alpha-pilot-readiness, Waves 0-2.**
  - Wave 0: fixes from an xhigh code review of the four preceding
    milestones — Color panel family-variant dedupe and alias tokenizing, a
    new `panel.derived.hasAntibody` fact so controls rules stop firing
    without an antibody involved, a new FMO control rule, a tested deploy
    pipeline, and knowledge-pack gaps filled in.
  - Wave 1: a "Copy feedback report" button (step, browser, KB health, full
    study, all as text) and a GitHub issues link.
  - Wave 2: structured panel assembly (a real `panel.channels` editor), a
    bench card export, a whole-study conformance check, and "Export for your
    own LLM" — a copy-paste prompt for whatever model the researcher already
    has open.

## [0.8.0] - 2026-08-03

### Added
- CSV and JSON study exports: a per-planned-filename file manifest and a
  full-fidelity JSON dump of the study document.

## [0.7.0] - 2026-08-02

### Added
- A fluorophore / color panel step: a qualitative spectral-spillover advisor
  over the active assay's markers field.

## [0.6.0] - 2026-08-02

### Added
- An in-app Guide step.
- A GitHub Pages auto-deploy workflow.

## [0.5.0] - 2026-08-01

### Added
- A study overview step: a shareable study diagram (HTML and an in-app SVG
  map), a deterministic walkthrough, and a staged progression ladder (idea to
  advanced modality).

## [0.4.0] - 2026-08-01

### Added
- **The assay tier (schema v3).** A study can hold several assays that share
  only a research question and a test article, each with its own modality,
  panel, and specimen — the real Romo-Rico et al. oregano study became the
  app's default. N-assay UI, readout and controls vocabulary, and an
  exportable design document shipped across four commits.

## [0.3.0] - 2026-07-31

### Added
- Modality advice: 16 rules across STED, confocal, widefield, light-sheet,
  SEM-TEM, and Raman, surfaced on the Describe, Design, and Naming steps —
  each note shows why it fired, not just what it says.

## [0.2.0] - 2026-07-30

### Added
- P1 vertical slice: the knowledge-pack loader, a predicate DSL, the
  interview engine, deterministic free-text ingest, and a condition matrix
  that resolves to sample IDs — a full paragraph-to-filenames path.

## [0.1.0] - 2026-07-29

### Added
- P0 vertical slice: the experiment schema, naming/validation ports, the
  single-file inliner, the store with tiered provenance, the app shell, and
  persistence — a working name-builder that runs from `file://`.
