# Changelog

All notable changes to the Micronaut Planner web app are documented here.
This project uses [Semantic Versioning](https://semver.org/). Reconstructed
retroactively — see [ROADMAP.md](../../ROADMAP.md) and
[TASKS.md](../../TASKS.md) for the day-to-day worklist this app was actually
built against; the version numbers below are annotated git tags placed on
that existing history, not a scheme that was tracked from day one.

## [Unreleased]

## [0.21.0] - 2026-09-12

### Added
- Opening the shipped example study now opens it in a second browser tab —
  a practice tab, at `index.html?demo=1` — running its own separate copy of
  the app against its own saved work, rather than replacing whatever was open
  in the tab you started from. `core/storageScope.js` resolves which set of
  saved data a tab reads and writes (today, exactly two: your own, and the
  practice tab's), and `ui/newTab.js` opens the practice tab by synthesising
  a click on a real link rather than calling `window.open` directly, so that
  a popup blocker sees an ordinary navigation and `rel="noopener"` can be set
  — which matters here beyond the usual advice, since `?demo=1` is
  same-origin and without it the practice tab would otherwise receive a live
  handle back into the tab holding your real study. The practice tab keeps
  its own edits between visits, and carries a bar across the top with its own
  **Reset to the example** control for starting over from the shipped plan.
- The Utilities menu's **Restore previous version** list now shows when each
  saved version was written, not just its title — a second line under each
  entry reading something like "5m ago" or "2h ago" for a recent save, and a
  plain local date (e.g. "Sep 11, 2026") once a save is a day old or more,
  via `ui/shell.js`'s new `restoreWhenLabel()`. This matters most exactly
  where the list used to be least useful: several saves in a row of a study
  that hasn't been retitled render as a stack of identical-looking "Untitled
  study" (or identical-title) rows with nothing to tell them apart. Every
  saved slot written before this change carries no save time at all, so that
  case is load-bearing rather than a corner to round off:
  `restoreWhenLabel()` returns an empty string for a missing, non-string, or
  unparseable value, and the row it belongs to simply omits the second line
  and looks exactly as it always has — never "Invalid Date". The added line
  is hidden from the button's accessible name (which would otherwise run the
  title and the time together with no separator between them); an explicit
  `aria-label` restates both as one properly punctuated phrase instead.

### Changed
- Opening the example study no longer has anything to protect: because it
  now runs in its own tab against its own saved work, your current study is
  never replaced, so there is nothing left to preserve it against. The
  copy that used to promise "your current study will be preserved in Restore
  and demo activity cannot remove it" is gone along with the risk it was
  written to cover; see the manual's Getting Started and Saving, Backups &
  Privacy chapters for the corrected walkthrough. (One honest limit worth
  restating here: the practice tab's isolation is by a distinct prefix
  within the browser's one shared storage per site, a strong convention
  rather than a separate vault — see `core/storageScope.js`'s header
  comment.)
- The guided example walkthrough — a tour of the example study specifically
  — is now reachable only from the practice tab the example opens in, since
  that is the only place the example itself is ever open.
- `openExampleStudy` (`core/appController.js`) now refuses outright to run
  outside the practice tab, logging an error rather than replacing the
  current study, so the one truly destructive path in that module stays
  unreachable no matter what ends up calling it — not only from today's
  actual call sites.
- **"Clear all stored data" is now scoped to the tab it's run from.**
  `persist.js`'s `clearAll()` sweeps by the same prefix `core/storageScope.js`
  now namespaces every key under, so running it from the practice tab clears
  only that tab's saved versions and running it from your own tab clears only
  yours — neither tab can reach across and wipe the other's history. Settings
  and the manual's Saving, Backups & Privacy chapter have been reworded to
  say so plainly, rather than the older "removes every locally saved version"
  phrasing that read as global.
- **Measurement status is now three independently scoped axes** — definition,
  plan, and export conformance — replacing the single three-word vocabulary
  that quietly conflated them. Each axis has its own statuses (Draft /
  Provisionally defined / Defined; Plan open / Needs a decision / Ready to
  acquire; Not checked / Blocked / Needs review / Checks pass), and the
  registry and the measurement switcher now read the same record instead of
  being able to disagree. See
  [docs/plans/status-scopes.md](../../docs/plans/status-scopes.md).
  **Visible behaviour change:** because real decision triage is now plumbed
  into the plan axis, a measurement that showed "Ready to acquire" yesterday
  may now show "Needs a decision" today. That is the intended correction —
  the plan axis was not actually checking for open decisions before — not a
  regression.
- Review's export verdict now reads "Export checks" / "All export checks
  pass" (plus an open-decision count when any remain), replacing the
  overstated "All planner checks complete"; its provenance sentence now
  credits authored knowledge-pack content instead of claiming everything on
  the page came only from what you typed.
- Observational studies can now complete the Measurements step of the
  workflow, which previously hard-required group levels only a
  groups-comparison study has.
- The guided example walkthrough is reachable again from the Study map's
  Start action, and the Guide's gate now accepts the `template` origin the
  app actually writes (it previously accepted only `example`, which nothing
  in the app wrote any more).
- The `.ics` schedule export now separates physical samples (mounting) from
  acquisition runs (acquisition) instead of reporting one count for both.

### Fixed
- Review's **Readout:** line read `null` for any readout you typed yourself.
  The label was looked up by the stored readout id, which only the shipped
  example study ever sets; it is now resolved from the text the interview
  actually recorded.
- The nav entry for the measurement you have open now shows that
  measurement's own status (Draft / Needs a decision / Blocked …), the same
  headline the Measurements registry row and the switcher pill show, instead
  of an aggregate across every measurement in a different vocabulary.
- Drop-downs start on a disabled "Choose…" placeholder rather than a blank
  row that could be re-selected; the Data plan's date picker shows the ISO
  form that will actually appear in filenames; the Study map has a Study
  title field, so entries in Utilities › Restore are no longer all
  "Untitled study"; a "Skip to content" link is the first Tab stop on every
  page.
- Spillover flag messages now say what they measure: the peak-to-peak
  distance under the threshold, with curve widths not considered. The 30 nm
  default filter band the spectral view draws is now declared in the
  spectra pack (`overlapRules.filterBandDefaultNm`) rather than hard-coded.
- The advisor and controls packs carry a pack-level review status, and the
  Guidance and Controls panels say so: this guidance is drafted, not yet
  checked by a microscopy specialist. Typing `PI` in the markers field now
  resolves to propidium iodide.
- The 0.19.0 notes no longer claim which variant CFP, GFP and mRuby store
  (no note or reference record exists for them), give the cited/drafted
  counts both per top-level entry (143/157) and per selectable spectrum
  (174/190), and name the 14 uncited entries on the page itself. Manual
  captions say the screenshots show the practice tab.
- The Measurement page now refreshes its sibling sections after an edit:
  renaming a group updates the Data plan's Group row and filename previews,
  typing markers updates the Acquisition colour panel and spectral view, and
  the header status badges follow the work instead of freezing at the state
  the page was opened in. Inputs you are typing in are never overwritten by
  that refresh. Biological/technical replicates have one editor (Samples &
  design); the duplicate Acquisition questions are gone.
- The Color panel's spillover check reads the Panel assembly channels (the
  same source Review uses), so the two can no longer disagree; each flagged
  pair carries an **Acknowledge this pair** control (sequential acquisition,
  filter-separated, other) that downgrades the block to a warning and is
  withdrawn automatically when either dye changes. Review lists every blocker
  by measurement and text with a visible "Blocks export" label and a link,
  lists each decision once, and the export toast names the first blocker.
- Panel a11y and layout: the conjugation select and remove button name their
  fluorophore, keyboard focus survives moving a channel, provenance badges
  read "cited source" instead of the raw enum, each fluorophore's authored
  note shows as a tooltip, channel rows scroll instead of being clipped at
  phone width, and spectral peak labels use the page ink colour.
- A measurement with no acquisition date renders the `UNKNOWN` placeholder,
  never `1970-01-01`, in previews, the registry row and every export.

- `localStorage` access throughout persistence is now guarded against a
  throwing storage backend, `clearAll` reports a real result instead of
  `undefined`, and starting a blank study no longer loses just-typed work to
  the 500ms autosave window.
- The autosave ring could starve itself: five "Start a blank study" actions
  in a row protected every slot, so the very next ordinary autosave was
  evicted by its own eviction pass while the shell still reported "Saved
  locally". Protected snapshots are now capped at three, the oldest
  protected snapshot is evicted first once that cap is exceeded, and the
  slot just written is never evicted by its own save.
- Restoring a previous version or importing a backup could silently drop
  the study you had open: if either landed inside the 500ms autosave
  window, or five autosaves happened before you noticed the swap, the
  displaced study was gone with nothing in Restore to bring it back. Both
  actions (and starting blank or opening the example) now flush the
  pending autosave and write one protected snapshot of the current study
  first, aborting with nothing changed if that snapshot fails. A failed
  save index write also restores the pre-save ring exactly instead of
  orphaning an evicted slot. Importing a file that isn't a valid project
  backup now says so in plain language instead of printing the raw
  `JSON.parse` error into the save indicator.
- "Clear all stored data" now also sweeps the app's own un-prefixed keys
  for the tab it's run from — walkthrough progress, onboarding answers,
  nav-rail collapse state, the advisor debug flag — so a clear that
  reported success no longer left "Continue walkthrough" or onboarding
  answers behind; the app's saved theme is deliberately left alone. Settings
  and the manual's Saving, Backups & Privacy chapter now describe what is
  actually cleared, and that the theme is kept.
- The spectral-overlap check that gates export now reads a measurement's
  fluorophores the same way the Panel step displays them — Panel assembly's
  channels first, the free-text Markers field only as a fallback — instead
  of the two disagreeing about which dyes are even in the panel. A
  measurement can no longer read "blocked" on Review while Panel assembly
  shows no conflict, or the reverse. Export checks now name every blocking
  issue by measurement and let you jump straight to it, rather than only
  reporting a bare pass/fail. Where two dyes really do sit too close to
  separate, you can record a per-pair acknowledgement (sequential
  acquisition, filter-separated, or another reason of your own) that
  downgrades the block to a visible warning instead of hiding it — the
  acknowledgement is tied to that specific pair of dyes and is withdrawn
  automatically if either one is swapped out.
- Group names, factor levels and other user-typed values that use
  non-Latin or symbol-only text no longer collapse into a silent
  `UNSPECIFIED` in exported filenames. The naming engine now reports
  exactly which value lost its characters and where, and the Design step
  and Review surface that report instead of leaving a reader to notice the
  placeholder on their own.
- The feedback package handoff no longer dead-ends when the browser refuses
  the clipboard write: the email and GitHub issue channels still offer to
  open the destination and download the same package to attach or paste in
  by hand, and the download channel's own confirmation no longer claims a
  copy that didn't happen.
- The Guide step's example-walkthrough copy no longer hard-codes "seven-step"
  for a walkthrough that is actually five steps long; the count is now read
  from the same step list the walkthrough runs.
- The release notes page's hero, lede and footer version now come from one
  source instead of three that could drift independently: an arithmetic
  slip ("Nine more" for what is actually ten more spectra entries), a
  mismatched nanometer figure attached to the wrong dye, and a partial list
  of the still-missing Alexa dyes are all corrected, and the 0.19.0 spectral
  story is now dated as history rather than presented as the current release.

## [0.20.0] - 2026-09-07

### Added
- A standalone user manual (`web/manual/`), linked from the nav rail as "User
  manual" (opens in a new tab, next to Release notes). Eleven chapters cover
  getting started, the app's big ideas, the study map, the research brief,
  the measurements registry, acquisition and the spectral view, conditions/
  groups/controls, naming and conformance validation, review and every
  export format, saving/backups/privacy, and a glossary and FAQ. Same
  static-site pattern as the release notes page: a hub with search, a
  sidebar chapter list, and a prev/next pager on every chapter -- no
  framework, no build step, and no network calls beyond fetching the
  manual's own pages for its search index. The Guide step in the app links
  out to the full manual for readers who want more than the in-app
  reference.
- Four reference screenshots (Samples & design, Data plan, Settings, and a
  measurement's suggested controls on Review), so the manual's chapters on
  conditions/controls, naming and backups illustrate the screens they
  describe instead of only naming them.

### Fixed
- `tools/capture_screenshots.py` positioned a scrolled-to section behind the
  app's own header. The header is a stack of sticky bars, each pinned below
  the one above, and only the topmost was measured -- so a capture aimed at a
  section heading cut off the heading and the first ~200px under it. It now
  measures the whole pinned stack, and takes its scroll targets as CSS
  selectors so a target with no id (Review's Controls block) can be captured.
  This also un-clips the existing Acquisition screenshot.

## [0.19.0] - 2026-09-05

### Fixed
- 26 fluorophores were storing the wrong peak wavelengths, and are now
  corrected against the manufacturer's own published figures. The two that
  mattered most: Alexa Fluor 488 was stored as 490/525 nm where Thermo's
  spectral table gives 495/519, and DRAQ5's emission was stored 16 nm low
  (681 nm against BioStatus's 697 nm for the DNA-bound dye). Nine ATTO dyes
  were out by 1-6 nm, and Calcein, CFSE, FITC, Nile Red, propidium iodide,
  TMRE, TMRM, Texas Red, DyLight 650, SYTO 9 and SYTO 85 were each out by a
  few nm (Nile Red the most, by 8 nm). Alexa Fluor 405, 514, 532 and 647
  round out the 26. If you planned a panel around one of these, its
  spillover flags and spectral-view curves will shift slightly.

### Changed
- 143 of the pack's 157 top-level fluorophore entries now cite a source, up
  from 72. Counted at the level a user actually picks a fluorophore -- 8 of
  those 157 entries are families that expand into 41 named variants, for
  190 selectable spectra in total -- 174 are cited and 16 are still
  drafted. Every remaining drafted entry was checked against a vendor or
  curator page, and each corrected or confirmed value is recorded in
  docs/references/planner-fluorophore-sources.json with the URL it came
  from and the date it was read.
- Seven probe families -- MitoTracker, LysoTracker, SYTOX, BODIPY,
  CellMask, LIVE/DEAD and SYTO -- had every one of their variants sourced,
  so the family is no longer marked as drafted. ER-Tracker still is: its
  Blue-White DPX variant has an emission range rather than a peak, and a
  family is only as cited as its least-documented member (its other two
  variants, Green and Red, are individually cited).

### Known gaps
- 14 top-level entries (16 once ER-Tracker's three variants are each
  counted on their own) are deliberately still marked as drafted rather
  than being quietly upgraded. Cy2, Cy7 and TRITC had no primary source
  worth citing (and TRITC is not one defined compound); DCFDA (H2DCFDA)'s
  stored peaks are for the oxidized, fluorescent DCF product -- the
  non-fluorescent loading form has no meaningful peak until intracellular
  oxidation converts it. ER-Tracker's Blue-White DPX variant has the same
  problem as DCFDA: its source gives an emission range, not a peak.
- The other nine store a single value under a key that could mean more
  than one real variant. CFP, GFP and mRuby carry no note in the pack
  saying which variant their numbers describe, and no reference record for
  one exists in this repo yet; IRFP is the exception -- its note names it
  as iRFP713, the most common near-infrared iRFP variant, and that value
  is the one of the four backed by a citation in
  docs/references/planner-fluorophore-sources.json. BFP, YFP and miRFP are
  similarly generic keys. Hoechst and GCaMP are not ambiguous names --
  the pack's own note for Hoechst names it specifically as Hoechst 33342,
  and GCaMP's note says every named variant (6f/6s/7/...) shares
  essentially one spectrum -- they simply haven't been checked against a
  source yet. The keys are left as they are for now, since renaming one
  would break studies that already use it.
- A cited entry means its two peak values match a source that was fetched
  and recorded. It does not mean a microscopy specialist has reviewed it,
  and the Gaussian curve widths used by the spectral view are still
  estimates for every entry in the pack, cited or not.

## [0.18.0] - 2026-09-05

### Added
- Imported project files are now shape-validated after migration, not just
  schema-migrated. A file that already claimed the current schema version
  used to skip every migration check and reach the app completely
  unvalidated; now it is checked either way. Files too damaged to use are
  rejected with the existing import error, and recoverable ones are
  sanitized -- the app tells you what was dropped. Malformed provenance
  entries, and entries that name a measurement the file doesn't actually
  have, are discarded, so a hand-edited file can no longer silently lock
  fields against later edits.
- The Restore menu can delete an individual saved recovery slot, and
  Settings has a two-click "Clear all stored data" action. Previously, a
  user whose browser storage was full was told so with no in-app way to
  free space -- the storage-full message now points at both.

### Changed
- 72 of the spectral pack's 157 fluorophore entries were checked against
  their cited vendor or publication sources and now carry a
  "source-cited" badge in place of "unreviewed" -- the remaining 85 are
  still the real review target. Family entries (LysoTracker, LIVE/DEAD,
  SYTO) stay claude-drafted on purpose: their uncovered sibling variants
  must not be certified by a family-level flag.
- The Fluorophores panel's review banner now describes that panel's own
  fluorophores instead of making a blanket claim -- a panel made up
  entirely of source-cited fluorophores no longer says it's unreviewed.
- Development: the documented `python3 tools/serve_dir.py web` command
  works again (it now generates `web/kb.dev.js` itself instead of
  importing a deleted script); the single-file build now refuses to
  bundle network primitives (fetch/XMLHttpRequest/WebSocket/sendBeacon/
  EventSource), so the app's no-network guarantee is enforced by the
  build rather than by convention; the naming template config moved to
  the engine layer so tests exercise the real one instead of a copy; and
  a new `tools/capture_screenshots.py` regenerates the app screenshots in
  `docs/images/`.

### Fixed
- The step rail's "Measurements" label no longer breaks mid-word when the
  status badge next to it leaves too little room -- it now wraps at a
  word boundary, or gives the badge its own line, instead.
- Review's Study map summary no longer shows a duplicated "Study map"
  heading directly above its own content.
- A measurement named the same as its own readout (e.g. "Bacterial
  viability") no longer echoes itself on Review's Study map summary --
  the readout is only shown when it adds information the label doesn't
  already give.
- The Release notes link now works when running the built single-file
  app or straight from disk, not only on the hosted site.

### Removed
- An unused, parallel Gemini-based agent pipeline
  (`tools/antigravity-multi-agent/`) and the repo's only third-party
  dependency list; leftover files from the archived Streamlit-era app;
  six dead exports; and ARL, a placeholder marker with no known
  identity.

## [0.17.0] - 2026-09-04

### Fixed
- The step rail's New study and Walkthrough labels were rendering in muted
  grey on their own accent fills -- Walkthrough's was about 1.4:1 against its
  solid teal, effectively invisible until hovered. Both now use their
  intended ink (at least 5.1:1 in light, 6.0:1 in dark).
- The step navigation rail no longer disappears or scrolls out of reach at
  high browser zoom. Below 900px it now narrows to an icon-only column
  (matching every other width) instead of turning into a horizontal strip
  that pushed Settings, Feedback, Release notes and Theme off-screen; below
  760px it no longer removes the rail outright, which had made those same
  four controls completely unreachable on narrow screens or heavy zoom.
- Settings, Feedback, Release notes and Theme now sit flush against the
  bottom of the screen, instead of hanging up to 22px below the fold.

### Changed
- The step rail's buttons are smaller and less boxy. Step items lost their
  44px floor and now size to their own content, and the control panel's six
  buttons (New study, Walkthrough, Settings, Feedback, Release notes, Theme)
  are a compact cluster rather than six more full-size step rows — so the
  whole rail now fits an ordinary laptop screen without scrolling. Touch
  devices keep the larger 44px targets.
- Settings and Feedback in the step rail's control panel switched from fixed
  saturated colors to the same neutral surface (accent-highlighted only when
  open) as every other step button.
- The narrow-screen navigation strip (with its own New study/Walkthrough
  buttons and measurement/step dropdowns) is removed; the icon-only rail
  above now covers every width down to a phone screen.

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
