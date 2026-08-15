# Roadmap

Last updated: 2026-08-12

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
- **Modality advice:** 16 rules across STED / confocal / widefield / light-sheet /
  SEM-TEM / Raman (`web/kb/advisor.json`), surfaced on the Describe / Design /
  Naming steps.
- **The assay tier (schema v3):** a study can hold several assays that share only a
  research question and a test article, each with its own modality / panel /
  specimen. All four commits shipped (N-assay UI, readout + controls vocabulary,
  the exportable design document); the real Romo-Rico et al. oregano study is the
  app's default. See [docs/plans/planner-web-assay-tier.md](docs/plans/planner-web-assay-tier.md).
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
  missing markers (`SYTO9`, `DCF`) plus a ~20-entry common-dye sweep.
- **Alpha-pilot-readiness (Wave 1 — feedback path):** a "Copy feedback report" header
  button (build-independent: step, browser, KB health, full study as text) plus a GitHub
  issues link; a Google Form / non-GitHub-email link is wired but left for Daniel to fill
  in (`FEEDBACK_FORM_URL`/`FEEDBACK_EMAIL` in `ui/shell.js`).
- **Alpha-pilot-readiness (Wave 2 — the rest of the roadmap, minus the LLM seam):**
  - **Structured panel assembly:** the long-reserved `panel.channels` is now a real editor
    (target, fluorophore, conjugation mode) — more precise than the free-text markers
    field, and what lets the controls engine know with certainty whether an antibody is
    involved. `engine/studydoc.js` prefers it over the free-text field once any channel
    exists.
  - **Bench card export:** a compact, print-oriented single-assay Markdown summary
    (channels, controls with reasons, two worked filenames), one per assay, on Overview.
  - **Conformance check:** one pass/fail verdict for the whole study, composed from every
    validator the app already runs per-step (design issues, naming-field patterns, path
    length, spillover flags, cross-assay collisions) — surfaced on Overview.
  - **"Export for your own LLM":** a copy-paste prompt (ground rules + the study as JSON +
    suggested questions) for whatever model the user already has open. The safer,
    zero-infrastructure stand-in for the in-app LLM seam below — this app never calls a
    model or holds a key.

  Full per-wave detail in TASKS.md's "Recently shipped."

Scope decisions and the use-case map behind the above:
[docs/plans/planner-web-mvp-usecases.md](docs/plans/planner-web-mvp-usecases.md).

### Next
- The **LLM seam** (in-app providers: manual-paste, then opt-in local Ollama +
  diagnostics) — the only item left from the original roadmap, explicitly deferred until
  after the alpha pilot. See docs/plans (or ask Daniel) for the connection options if
  "how would this even work without an API key" comes up — local Ollama needs no key,
  since `http://localhost` is a secure origin browsers already trust.

**⚠ Parked review — `web/kb/spectra.json` content.** Every fluorophore's excitation/
emission peak values are Claude-drafted from common published references (same "Claude
drafts, Daniel corrects" arrangement as `advisor.json`), not yet verified against FACSI's
actual reference sources or filter sets. The two overlap thresholds
(`emissionProximityNm`/`excitationProximityNm`) are likewise a judgment call pending
review once `K-3` (instruments/objectives/lines/detectors) exists. Flagged in-app too (a
persistent banner on the Color panel step). The pack grew substantially in Wave 0 (a
~20-entry common-dye sweep, several new fluorophore families) — still entirely unreviewed
and now a higher-priority review target given the added surface.

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
