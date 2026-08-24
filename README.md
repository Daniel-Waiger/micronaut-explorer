# μicronaut

μicronaut — a static, zero-install **microscopy experiment planner**.
(The µ is the micron symbol; the project name is pronounced "Micronaut.")

The active project is the web **Planner** (`web/`).

| Tool | What it is | Status |
|------|------------|--------|
| **Micronaut Planner** (`web/`) | A static, zero-install browser app that walks a researcher from design intent → measurements, panel, controls, acquisition → a data plan as a downstream artifact. No upload, no install, no server required — an optional, off-by-default panel can call a local LLM (e.g. Ollama) on your own network if you configure one. | **Active** |

Micronaut Classic, an earlier metadata-aware file renamer, was archived at tag
`classic-final` and `_archive/micronaut-classic-2026-08-18.tar.gz` — see
ROADMAP.md for why.

---

# Micronaut Planner (`web/`)

A static, single-page experiment planner. Vanilla ES modules with **zero npm
dependencies**, flattened at build into one self-contained HTML file that runs
identically from `file://`, a local server, or GitHub Pages.

## What it does today

The planner walks these steps (jump to any of them — the app is usable
outside-in, no forced order):

- **Study map** — the study-level surface above every measurement. A real study can contain
  several measurements that share a research question and test article, each with
  its own modality, panel, and specimen; the persisted schema keeps them in its
  compatible `assays` collection.
- **Research brief** — save a plain-language study description, then choose **Review
  description**. Micronaut first extracts only deterministic exact-text matches:
  marker aliases from the dictionary, biological-replicate counts, magnification,
  and unambiguous ISO dates. Everything else remains saved narrative unless the
  researcher explicitly reviews and accepts a suggestion.
- **Measurements** — name and select the observations or analyses used to answer the study question.
  A measurement is one observation or analysis; some disciplines call it an assay.
- **Samples & design** — per-measurement groups, replication, and design details.
- **Acquisition** — modality, panel, and per-measurement readouts/controls, with
  modality-specific advice (STED / confocal / widefield / light-sheet / SEM-TEM /
  Raman) surfaced from a rules knowledge base (`web/kb/advisor.json`).
- **Data plan** — builds the filename convention from the finished design, reusing
  Classic's naming/validation logic ported to JS.
- **Color panel** — a qualitative spectral-spillover advisor over the active measurement's
  fluorophores: excitation/emission peak-proximity flags, not a spectral-overlap
  integral. Content is Claude-drafted and flagged unreviewed (`web/kb/spectra.json`).
  An optional structured panel editor below it lets you name each channel's target
  and conjugation mode (direct antibody / indirect / genetically encoded / a
  direct-binding probe / self-labeling tag) — the fact-precise alternative to the
  free-text markers field, and what lets the controls engine tell whether an
  antibody is actually involved.
- **Review** — a shareable study diagram, a conformance check (one pass/fail
  verdict composed from every validator the app already runs), a deterministic
  walkthrough, a staged progression ladder (idea → advanced modality), and
  downloads: Markdown, an SVG study map, a CSV file manifest, a raw-data JSON
  dump, a per-measurement print-oriented bench card, and a separate **Copy prompt for
  your own LLM** action (+ the study as JSON) for discussing the finished plan
  in whatever LLM you already use.
- **Guide** — an in-app user guide, always in the step nav.

A "Copy feedback report" button in the header copies the current step, browser,
and full study as text — for reporting problems during the alpha.

Everything works with the optional local model **disabled** — the deterministic
exact-text review is always the floor, not a claim to understand every sentence
of a scientific description. If the researcher explicitly enables a local
Ollama endpoint in **Model options**, Micronaut may add bounded interpretations
of the active Research brief fields. Choice values remain limited to the supplied
vocabulary, and every model or pasted suggestion must carry a verbatim quote
from the saved description as evidence. Unsupported prose remains narrative.

Local interpretation is private to the endpoint the researcher configures.
If local calls are disabled, unavailable from `file://` or offline, rate
limited, fail, or return malformed output, the same Review area keeps the
deterministic results and offers an in-place **Use copy and paste instead**
continuation. The researcher can copy the constrained review prompt, paste a
reply back, and inspect it under the same evidence and vocabulary checks.

Review suggestions are never applied merely because a parser or model produced
them. The Research brief workspace groups exact, local, and pasted candidates, shows
their quoted warrants and any conflicts/current value, and requires an explicit
**Accept suggestion** or **Replace current value** action before a field is
written. The model can contribute reviewable proposals, but no field is applied
without explicit review and acceptance.

Research brief has no new-tab draft workflow, hosted-chat link-out, or generic
Ask surface. The Review **Copy prompt for your own LLM**
action remains a separate, read-only export of the finished plan.

## Run it locally

Development (unbundled, served over HTTP so ES-module imports resolve):

```bash
python tools/serve_dir.py web
```

Then open the printed URL. (The `web/kb.dev.js` aggregate the unbundled page needs
is generated by `python tools/export_markers_kb.py`; it's git-ignored because the
built single file embeds the KB directly.)

Build the self-contained single file:

```bash
python tools/build_single_file.py --web-dir web --out dist
```

This inlines CSS, JS, and the knowledge pack into `dist/index.html` — one file you
can double-click (`file://`) or host anywhere, with identical bytes either way. The
build enforces hard gates (no `fetch()`, no `type="module"`, no duplicate exports,
no import cycles, size ceiling) so the shipped artifact can't silently break.

Serve the built output the same way:

```bash
python tools/serve_dir.py dist
```

## Test it

```bash
node --test web/tests/*.test.js
```

No `npm install`, ever — `web/` is a deliberately zero-dependency project (the
minimal `web/package.json` only sets `"type": "module"`). The glob is required;
bare `node --test web/tests/` fails with `MODULE_NOT_FOUND` on Node 22.

---

## Repository layout

```
web/                         Micronaut Planner (static browser app)
  index.html                 dev entry (BUILD:* markers for the inliner)
  src/core/                  schema, store, tiered provenance, router, persistence
  src/engine/                naming, validation, interview, advisor, controls, spectra, render
  src/ui/steps/              study, describe, design, naming, panel, overview, guide
  kb/                        knowledge pack (markers, stages, controls, advisor, spectra, …)
  tests/                     node --test suite (zero npm deps)

tools/build_single_file.py   Planner inliner → dist/index.html
tools/serve_dir.py           static dev server (PORT-aware)
docs/                        plans, cma-lessons, images
```

The marker/fluorophore dictionary (`web/kb/markers.json`) is hand-edited and
canonical — see [web/kb/markers.README.md](web/kb/markers.README.md).

## Run the tests

JavaScript (Planner):

```bash
node --test web/tests/*.test.js
```

CI runs the JS suite plus the Planner's own Python build-pipeline tests
(`tests/test_single_file_build.py`, `tests/test_kb_json_valid.py`,
`tests/test_regex_conformance.py`) — see
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## License

This project is licensed under the Apache License, Version 2.0. See the
[LICENSE](LICENSE) file for the full text.
