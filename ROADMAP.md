# Roadmap

Last updated: 2026-09-12

Near-term worklist: [TASKS.md](TASKS.md). This file is the high-level direction.

## Current status

The active project is the **web Planner** (`web/`) — a static, zero-install
microscopy experiment planner. See [docs/plans/planner-web.md](docs/plans/planner-web.md)
for the full plan and
[docs/plans/planner-web-task-graph.json](docs/plans/planner-web-task-graph.json)
for the authoritative per-task spec.

**Micronaut Classic** — the Python metadata-extraction + file-renaming tool
(`src/`, `app_streamlit.py`) — is **parked: not going forward in the near term.**
It is complete and usable, but the extraction/renaming approach is not being
carried forward; the "Parked" section at the end records what shipped and the
ideas that were on its backlog, all now deferred.

## Planner — active direction

### Delivered
- **P0:** experiment schema, the naming/validation ports, the single-file inliner,
  store + tiered provenance, app shell, persistence, and a working name-builder
  vertical slice that runs from `file://`.
- **P1:** KB loader, predicate DSL, interview engine, deterministic free-text
  ingest, condition matrix → sample IDs.
- **Modality advice:** 17 rules across STED / confocal / widefield / light-sheet /
  SEM-TEM / Raman (`web/kb/advisor.json`), surfaced on the Research brief and the
  measurement's Samples & design, Acquisition and Data plan sections.
- **The assay tier (schema v3):** a study can hold several assays that share only a
  research question and a test article, each with its own modality / panel /
  specimen. All four commits shipped (N-assay UI, readout + controls vocabulary,
  the exportable design document); the real Romo-Rico et al. oregano study opens
  only in the practice tab (`index.html?demo=1`) — a first run starts blank. See
  [docs/plans/planner-web-assay-tier.md](docs/plans/planner-web-assay-tier.md).
- **Study overview step:** a shareable study diagram (HTML + an in-app SVG map) + a
  deterministic walkthrough, plus a staged progression ladder (idea → advanced modality),
  exportable as Markdown/mermaid.
- **In-app Guide step** and a **GitHub Pages auto-deploy workflow**
  (`.github/workflows/deploy.yml`).
- **Fluorophore / color panel:** a qualitative spectral-spillover advisor over the active
  assay's markers field — excitation/emission peak-proximity flags, no overlap-integral
  math. See [docs/plans/planner-web-color-panel.md](docs/plans/planner-web-color-panel.md).
- **Exports — file manifest (CSV) and raw data (JSON):** two more study-overview export
  buttons alongside the existing Markdown/mermaid/SVG/print ones — a per-planned-filename
  CSV manifest (assay, group, factors, replicates, filename) and a full-fidelity JSON dump
  of the same study document. See
  [docs/plans/planner-web-exports.md](docs/plans/planner-web-exports.md).
- **Alpha-pilot-readiness (Wave 0 — review fixes):** an xhigh code review of the four
  commits above found 15 issues, several confirmed by running the real committed KB
  through the app's own code. Fixed: the Color panel's family-variant dedupe,
  hyphenated-alias tokenizing, and "no markers declared" sentinel handling; the controls
  engine's isotype/secondary-antibody-control rules firing on every panel regardless of
  whether an antibody was involved (a NEW `panel.derived.hasAntibody` fact, computed from
  a NEW `target` marker class distinct from `moiety`, fixes this) plus a new FMO control
  rule; the deploy workflow's own build pipeline was previously untested and unverified
  before publishing; `web/kb/markers.json`/`spectra.json` gained the default study's own
  missing markers (the SYTO family's `syto9` alias, and DCFDA's `dcf` alias) plus
  a ~20-entry common-dye sweep.
- **Alpha-pilot-readiness (Wave 1 — feedback path):** a "Copy feedback report" header
  button (build-independent: step, browser, KB health, full study as text) plus a GitHub
  issues link; a Google Form / non-GitHub-email link is wired but left for Daniel to fill
  in. (Superseded 2026-09-03: the feedback path moved to a Feedback page, and the one
  constant to fill in is now `FEEDBACK_EMAIL` in `ui/feedbackHandoff.js`. See TASKS.md.)
- **Alpha-pilot-readiness (Wave 2 — the rest of the roadmap, minus the LLM seam):**
  - **Structured panel assembly:** the long-reserved `panel.channels` is now a real editor
    (target, fluorophore, conjugation mode) — more precise than the free-text markers
    field, and what lets the controls engine know with certainty whether an antibody is
    involved. `engine/studydoc.js` prefers it over the free-text field once any channel
    exists.
  - **Bench card export:** a compact, print-oriented single-assay Markdown summary
    (channels, controls with reasons, two worked filenames), one per assay, on Overview.
  - **Conformance check:** one readiness verdict for the whole study (blocked / needs
    review / ready), composed from the validators the app runs per-step (design issues,
    naming-field patterns, filename length, spillover flags, cross-assay collisions) —
    surfaced on Review. It does not check scientific validity, statistical power,
    ethics, biosafety or instrument suitability.
  - **"Export for your own LLM":** a copy-paste prompt (ground rules + the study as JSON +
    suggested questions) for whatever model the user already has open. The safer,
    zero-infrastructure stand-in for the in-app LLM seam below — this app never calls a
    model or holds a key.

  Full per-wave detail in TASKS.md's "Recently shipped."

Scope decisions and the use-case map behind the above:
[docs/plans/planner-web-mvp-usecases.md](docs/plans/planner-web-mvp-usecases.md).

### Pilot-readiness restructure (2026-09-03)
Three changes, driven by one finding: the app could not be tested for "does the flow
make sense?" because it did not have one flow. Full detail in TASKS.md and the commit
messages.

- **One front door.** The onboarding modal is gone (Home already offered the same
  choices), the feature tour no longer starts itself, and a first run starts blank
  rather than inside the shipped example.
- **Nouns, not steps.** Ten routes became five plus three utilities: Study map,
  Research brief, Measurements (a searchable registry), the measurement you opened,
  and Review. Samples & design, Acquisition and Data plan are sections of one
  measurement page, composed from the existing step objects rather than rewritten.
- **Status is three independently scoped axes, not one collapsed vocabulary** —
  definition, plan, and export conformance — each with its own statuses. The
  headline badge shows whichever axis isn't yet at its top status, and
  **Ready to acquire** now names only the plan axis's top status rather than a
  single word standing in for all three. `conformance` remains the sole export
  gate. See [docs/plans/status-scopes.md](docs/plans/status-scopes.md).

### Deliberately deferred: first-class study shapes
**Not in this pass.** `comparisonMode` is currently a flag (`groups` /
`observational`) rather than a first-class notion of study shape. The idea
worth doing eventually is to model `observational | group-comparison |
factorial | mixed` explicitly, so the workflow, the Study map's questions, and
the conditions engine can each reason about the actual design shape instead
of inferring it from one flag plus whatever factors happen to be present.
That is a schema change with migration consequences for every persisted study
and every plan doc that currently reasons about `comparisonMode`, so it is
explicitly parked rather than folded into this pass.

### The LLM seam: closed, not deferred
**The in-app model path has been removed rather than finished.** Micronaut never calls
a model. The remaining path is one-way: Review's "Copy prompt for your own LLM" hands
the researcher a block for whatever model they already use, and nothing that model
produces is parsed back into the study.

The reasoning, since this reverses the earlier plan: the local-Ollama seam only worked
for people who had Ollama installed, and it spent ~2,500 lines of source plus ~1,160 of
tests guarding a write path whose payoff was saving a few seconds of typing the
researcher still had to check. Naming the questions worth asking about a design is the
part a bench scientist cannot do alone; filling in their fields was not. With no write
path there is nothing left to guard, which is a stronger guarantee than any validator.

The deterministic exact-text scan on Research brief stays — it is honest, cheap, and
quotes what it matched.

**⚠ Parked review — `web/kb/spectra.json` content.** 143 of the pack's 157 entries are
now `reviewStatus: "source-cited"` (a vendor or publication source recorded in the
fluorophore-expansion pass of 2026-08-13 and 2026-09-05, see
`docs/references/planner-fluorophore-sources.json`);
14 remain Claude-drafted from common published references and are not yet verified
against FACSI's actual reference sources or filter sets. None of it has been reviewed by
a microscopy specialist. The two overlap thresholds (`emissionProximityNm`/
`excitationProximityNm`) are likewise a judgment call pending review once `K-3`
(instruments/objectives/lines/detectors) exists. Flagged in-app too — the Color panel
step's banner picks one of three texts depending on the panel's own mix of cited vs.
drafted entries (all-cited / all-drafted / mixed), not a single persistent claim. The
pack grew substantially in Wave 0 (a ~20-entry common-dye sweep, several new fluorophore
families) — still not specialist-reviewed and now a higher-priority review target given
the added surface.

### Content — owned by Daniel, not code
Authored in the knowledge pack (`web/kb/`): fluorophore identities and spectra,
FACSI instruments / objectives / lines / detectors, the question bank, control
rules, golden-experiment regression fixtures, and modality profiles.

**⚠ Parked review — `web/kb/advisor.json` wording.** Every rule's `concept` (the
phenomenon, e.g. "spectral spillover") and `body` (the mechanism) is Claude-drafted
per the standing "Claude drafts, Daniel corrects" instruction and not yet reviewed
for terminology a FACSI user would recognize — e.g. "spillover" vs "crosstalk" vs
"bleed-through" (the confocal rule's body says "bleed-through" while its concept
says "spectral spillover"), and whether "shadow striping" / "spherical aberration"
are the right register. The rules themselves in `web/kb/advisor.json` are the full list.

## Parked: Micronaut Classic (not going forward in the near term)

**Archived 2026-08-18:** this section is now historical record only. The code
moved to `_archive/micronaut-classic-2026-08-18.tar.gz` (tag `classic-final`).

Classic reached a complete, usable state: bounded metadata extraction with a
heuristic fallback, structured OME / per-format extraction, an externalized
marker/fluorophore dictionary, per-field provenance, profile validation, batch
apply with rollback, `--json` output, a free-text describer, and a Streamlit UI.
Full detail is in [CHANGELOG.md](CHANGELOG.md).

These were on Classic's backlog and are **now deferred** — kept for the record,
not scheduled:

- Multi-image container handling (LIF series / CZI scenes / ND2 points), which the
  extractor currently reads only the first scene of.
- The safe-renaming hardening cluster: rename companion/sidecar files together,
  always preserve the original name, transactional (all-or-nothing) batch apply,
  warn on cloud-synced/locked files, and filesystem edge cases (Windows MAX_PATH,
  case-insensitive collisions, reserved names).
- Deeper LLM guardrails: validate model output against the available evidence and
  keep suggestions reproducible (pin model/seed).
- Open-weights model support (e.g. Qwen 3.5, Gemma) for the enhancer/describer.
- Format-mask-based "friendlier naming" (masks instead of regex, an example under
  every field).

The planning-side ideas here (notably "plan the name before you acquire") are
subsumed by the web Planner, which is why the pivot made them redundant rather
than merely postponed.
