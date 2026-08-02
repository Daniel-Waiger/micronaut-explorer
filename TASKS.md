# Open tasks — Micronaut Planner

Last updated: 2026-08-02

> **Draft — Claude-authored from ROADMAP + git history; Daniel to confirm/reprioritize.**
> Authoritative scope for any listed item lives in its plan doc under `docs/plans/`.
> `ROADMAP.md` holds the long-range "why"; this file is just the near-term worklist.
>
> The old contents of this file (the Classic "Review Remediation" execution plan) are
> **done** — that work shipped and is frozen. Micronaut Classic (`src/`, `app_streamlit.py`)
> is maintenance-only; new work is on the web Planner. The old plan is archived at
> `_archive/docs/TASKS-classic-review-remediation.md` if needed.

## Near-term

- **Assay tier — commit 4: the exportable design document.** The last commit of the
  assay-tier arc (commits 1–3 shipped). A pure read/renderer over the settled v3 model,
  no schema change. Plan: [docs/plans/planner-web-assay-tier.md](docs/plans/planner-web-assay-tier.md).
- **Fix stale status header in the assay-tier plan.** Its top line still says "commits 2–4
  not started," but 2 and 3 shipped (`87b26ae`, `9361d8c`, `b7c5a96`). One-line correction.
- **Fluorophore / color panel (spillover).** Its own page; rules qualitative-first, no
  spectral-overlap integrals yet. Not started. See ROADMAP "experimental-design assistant."

## Content authoring (owned by Daniel, not code)

Lives in the knowledge pack (`web/kb/`); see the K-1…K-7 list and the parked review of
`web/kb/advisor.json` wording in [ROADMAP.md](ROADMAP.md).

## Later (see ROADMAP for full phase list)

- Exports: bench card / CSV / Markdown / JSON.
- LLM seam: manual-paste provider, then opt-in Ollama + diagnostics.
- GitHub Pages deploy workflow (none exists yet — only `ci.yml`).
- Formally freeze/label Micronaut Classic as read-only.
