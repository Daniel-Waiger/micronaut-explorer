# Roadmap

Last updated: 2026-08-02

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

Scope decisions and the use-case map behind the above:
[docs/plans/planner-web-mvp-usecases.md](docs/plans/planner-web-mvp-usecases.md).

### Next
- **Exports** (bench card / CSV / Markdown / JSON — Markdown/mermaid already shipped for
  the study overview; bench card / CSV / JSON still open), the **LLM seam** (manual-paste
  provider first, then opt-in Ollama + diagnostics), and a **conformance check**.
- Fuller **panel assembly** (`panel.targets`/`panel.channels`, direct/indirect conjugation
  structure) — deliberately out of scope for the color panel above, which reads the
  existing free-text markers field instead. Still reserved, zero consumers.

**⚠ Parked review — `web/kb/spectra.json` content.** Every fluorophore's excitation/
emission peak values are Claude-drafted from common published references (same "Claude
drafts, Daniel corrects" arrangement as `advisor.json`), not yet verified against FACSI's
actual reference sources or filter sets. The two overlap thresholds
(`emissionProximityNm`/`excitationProximityNm`) are likewise a judgment call pending
review once `K-3` (instruments/objectives/lines/detectors) exists. Flagged in-app too (a
persistent banner on the Color panel step).

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
