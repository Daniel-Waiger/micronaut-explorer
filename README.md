# μicronaut

μicronaut — a static, zero-install **microscopy experiment planner**.
(The µ is the micron symbol; the project name is pronounced "Micronaut.")

The active project is the web **Planner** (`web/`).

| Tool | What it is | Status |
|------|------------|--------|
| **Micronaut Planner** (`web/`) | A static, zero-install browser app for planning a microscopy study: what you're asking, what you'll measure, and the files, controls and conditions that follow from it — decided before you're at the microscope. No upload, no install, no server, and no model is ever called. | **Active** |

Micronaut Classic, an earlier metadata-aware file renamer, was archived at tag
`classic-final` and `_archive/micronaut-classic-2026-08-18.tar.gz` — see
ROADMAP.md for why.

---

# Micronaut Planner (`web/`)

A static, single-page experiment planner. Vanilla ES modules with **zero npm
dependencies**, flattened at build into one self-contained HTML file that runs
identically from `file://`, a local server, or GitHub Pages.

## What it does today

The planner has three workspaces plus a review. They are things a study *has*,
not steps to march through — jump to any of them in any order:

- **Study map** — the shape of the study: the research question, the system or
  material, whether you're comparing groups or observing, and what counts as one
  independent experimental unit. Everything else follows from these. A study can
  hold several measurements that share a question and test article, each with its
  own modality, panel, and specimen; the persisted schema keeps them in its
  compatible `assays` collection.
- **Research brief** — save a plain-language study description, then choose **Review
  description**. Micronaut first extracts only deterministic exact-text matches:
  marker aliases from the dictionary, biological-replicate counts, magnification,
  and unambiguous ISO dates. Everything else remains saved narrative unless the
  researcher explicitly reviews and accepts a suggestion.
- **Measurements** — a registry of the observations or analyses used to answer the
  study question: search it, filter by status or modality, and open one to plan it.
  A measurement is one observation or analysis; some disciplines call it an assay.
  Each row carries one status — **Draft**, **Needs a decision**, or **Ready to
  acquire**. "Ready" means the planner's own checks are satisfied; it never claims
  the experiment is correct, powered, or approved.
- **A measurement's own page** — opening a row gives you that measurement's whole
  plan on one scroll, because these three decide each other:
  - *Samples & design* — groups, replication, and the conditions they generate.
  - *Acquisition* — modality, panel, and readouts/controls, with modality-specific
    advice (STED / confocal / widefield / light-sheet / SEM-TEM / Raman) from a
    rules knowledge base (`web/kb/advisor.json`).
  - *Data plan* — the filename convention built from the finished design, reusing
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

A **Feedback** page collects what you were doing, the current page, browser
details, and your full study into one package you can copy, download, or take
to a GitHub issue. The GitHub issue path pre-applies the `feedback` label
(GitHub's new-issue form reads it from the link's own query string), so
feedback opened from the app is one filterable group inside the repo — no
server or credential involved. Nothing is sent anywhere unless you choose one
of those actions.

## On language models

**Micronaut never calls a model.** Every result in the app is deterministic, and
nothing a model produces is read back into your study. There is no API key, no
endpoint to configure, and no network request.

Two things use a model's help, both one-way:

- **Research brief review** is a deterministic exact-text scan of your saved
  description. It recognises marker aliases from the dictionary, biological
  replicate counts, magnification, and unambiguous ISO dates — and nothing else.
  Each suggestion quotes the exact text it matched, and no field is written until
  you choose **Accept suggestion** or **Replace current value**. Everything the
  scan did not match stays narrative; the app never claims to have understood
  your whole description.
- **Review → Copy prompt for your own LLM** hands you a block to paste into
  whatever model you already use: ground rules that keep it from inventing a
  marker or a setting, your study as JSON, the decisions Micronaut can tell you
  have not been made yet, and questions worth asking. You read the reply and act
  on it yourself.

Earlier versions could call a local Ollama endpoint and parse a pasted model
reply back into study fields. That path is gone. It only worked for people who
had Ollama installed, and it spent a lot of machinery guarding a write path that
saved a few seconds of typing you still had to check. Asking a model which
questions to ask about your own design is the part worth having; letting it fill
in your fields was not.

## Run it locally

Development (unbundled, served over HTTP so ES-module imports resolve):

```bash
python tools/serve_dir.py web
```

Then open the printed URL. (The `web/kb.dev.js` aggregate the unbundled page needs
is generated automatically by `tools/serve_dir.py` itself, from `web/kb/*.json`;
it's git-ignored because the built single file embeds the KB directly.)

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
  src/engine/                naming, validation, interview, advisor, controls, spectra,
                             measurement status, render
  src/ui/steps/              home (study map), describe, study (registry),
                             measurement (composes design + panel + naming),
                             overview, guide, feedback, settings
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
