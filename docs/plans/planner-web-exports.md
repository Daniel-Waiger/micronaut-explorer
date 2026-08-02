# Plan: Exports — file manifest (CSV) and raw data (JSON)

Status: implemented, ship-gated, awaiting user review before commit.
Self-selected from ROADMAP.md's "Next" list (user unavailable to disambiguate
among Exports / LLM seam / conformance check at kickoff).

## Scope

The study overview step already exports Markdown and an SVG study map. This
adds two more renderers over the same `buildStudyDocument` model
(`web/src/engine/studydoc.js`), following its own "one model, many renderers"
convention:

- **CSV file manifest** (`web/src/engine/render/csv.js`, `renderCsv(doc)`):
  one row per planned filename across every assay — `assay, modality, group,
  factors, biological_replicate, technical_replicate, planned_filename,
  error`. Crossing factors flatten into one `factors` cell (`name=level;
  name2=level2`) rather than one column per factor name, since different
  assays in the same study can declare different factors — a fixed column
  set would go ragged. RFC 4180 quoting/escaping, CRLF line endings.
- **JSON raw dump** (`web/src/engine/render/json.js`, `renderJson(doc)`):
  `JSON.stringify(doc, null, 2)` — already deterministic, no extra
  normalization needed.

`studydoc.js`'s per-assay `filenames` entries previously discarded the
condition `row` (group/factorLevels/bioRep/techRep) after using it to build
the filename string. Extended (additively) to carry that row forward, since
the CSV renderer needs it and re-deriving the condition matrix downstream
would violate the module's own "one model" premise.

Two new buttons wired into `web/src/ui/steps/overview.js`'s existing
`actions` div, matching the existing Markdown/SVG button pattern exactly
(rebuild the document fresh on click, `downloadTextFile`, toast on success).

## Explicitly deferred

**Bench card** — a compact, print-oriented single-assay summary — is NOT
part of this pass. Unlike CSV/JSON (mechanical projections of an existing
model), a bench card needs real content/UX judgment calls (what goes on it,
layout, what's print-worthy vs. not) that aren't specified anywhere yet.
Left open on ROADMAP.md's "Next" list.

## Verification (ship gate)

- `node --test web/tests/*.test.js` — 507/507 passing (was 495 before this
  work; +12 from `csv.test.js` (7), `json.test.js` (5), plus one added
  assertion in `studydoc.test.js` for the new `row` field).
- `tools/build_single_file.py --out dist` — 387,628 bytes, under the 2 MB
  gate.
- Manual browser verification against the built `dist/index.html`: both new
  buttons appear in the Overview step in the expected order, both trigger a
  successful download + success toast, zero console/page errors across
  either click.
