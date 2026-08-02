# Open tasks — Micronaut Planner

Last updated: 2026-08-02

> **Draft — Claude-authored from ROADMAP + git history; Daniel to confirm/reprioritize.**
> Authoritative scope for any listed item lives in its plan doc under `docs/plans/`.
> `ROADMAP.md` holds the long-range "why"; this file is just the near-term worklist.
>
> The old contents of this file (the Classic "Review Remediation" execution plan) are
> **done** — that work shipped. Micronaut Classic (`src/`, `app_streamlit.py`) is now
> **parked: not going forward in the near term**; all work is on the web Planner. The old
> plan is archived at `_archive/docs/TASKS-classic-review-remediation.md` if needed.

## Near-term

- Nothing queued right now — the two items on this list (assay-tier commit 4, the color
  panel) both shipped this session; see "Recently shipped" below. Next up is whatever
  Daniel prioritizes from ROADMAP's "Next" list (exports, the LLM seam, a conformance
  check, or the fuller panel-assembly model).

## Recently shipped (2026-08-02, not yet reflected elsewhere until this pass)

- **Assay tier — commit 4: the exportable design document.** Shipped via the
  `feat/study-overview-walkthrough` merge (`b7c5a96`): `engine/studydoc.js` (model),
  `engine/render/{markdown,mermaid}.js`, `ui/steps/overview.js`. Plan:
  [docs/plans/planner-web-assay-tier.md](docs/plans/planner-web-assay-tier.md).
- **In-app SVG study map** (`engine/render/svgDiagram.js`) — a further renderer over the
  same studydoc model, added after commit 4 as an alpha-prep addition. Note: this reverses
  the explicit "No SVG" decision recorded in the study-overview-walkthrough plan; worth a
  one-line note in that plan explaining why, if anyone goes looking.
- **In-app Guide step**, and a **GitHub Pages auto-deploy workflow**
  (`.github/workflows/deploy.yml`) — the "GitHub Pages deploy (none exists yet)" item in
  ROADMAP's Next list is now done, not pending.
- **Fluorophore / color panel (spillover).** A new "Color panel" step: qualitative
  excitation/emission peak-proximity flags over the active assay's markers field.
  Content (`web/kb/spectra.json`, 63 fluorophores) is Claude-drafted and flagged for
  review, same arrangement as `advisor.json`. Plan:
  [docs/plans/planner-web-color-panel.md](docs/plans/planner-web-color-panel.md).

## Content authoring (owned by Daniel, not code)

Lives in the knowledge pack (`web/kb/`); see the K-1…K-7 list and the parked review of
`web/kb/advisor.json` wording in [ROADMAP.md](ROADMAP.md).

## Later (see ROADMAP for full phase list)

- Exports: bench card / CSV / Markdown / JSON.
- LLM seam: manual-paste provider, then opt-in Ollama + diagnostics.
- GitHub Pages deploy workflow (none exists yet — only `ci.yml`).
