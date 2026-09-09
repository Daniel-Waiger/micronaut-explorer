#!/usr/bin/env node
// Renders the two Micronaut Planner outputs that are never visible IN the
// app -- the bench card (downloaded as a .md file) and the LLM prompt
// (written straight to the clipboard) -- using the app's own real engine
// modules against the shipped example study, so their content in the post
// images is exactly what the app produces, never paraphrased or hand-typed.
//
// This mirrors web/src/ui/steps/overview.js's own producer chain
// (buildStudyDocument -> checkConformance -> buildExperimentMap ->
// decisionTriage -> renderBenchCard/renderLlmPrompt) and web/src/main.js's
// loadAppKb (aggregate web/kb/*.json by filename stem, shapeAppKb it) --
// nothing here is a second implementation of either.
//
// Usage: node tools/render_artifacts.mjs <out-dir>
// Writes <out-dir>/benchcard.md and <out-dir>/llmprompt.txt.

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(REPO_ROOT, 'web', 'src');
const KB_DIR = path.join(REPO_ROOT, 'web', 'kb');

const { createDefaultStudy } = await import(path.join(WEB_SRC, 'core', 'defaultStudy.js'));
const { shapeAppKb } = await import(path.join(WEB_SRC, 'engine', 'kbpack.js'));
const { buildStudyDocument } = await import(path.join(WEB_SRC, 'engine', 'studydoc.js'));
const { checkConformance } = await import(path.join(WEB_SRC, 'engine', 'conformance.js'));
const { buildExperimentMap } = await import(path.join(WEB_SRC, 'engine', 'experimentMap.js'));
const { decisionTriage } = await import(path.join(WEB_SRC, 'engine', 'decisionTriage.js'));
const { renderBenchCard } = await import(path.join(WEB_SRC, 'engine', 'render', 'benchcard.js'));
const { renderLlmPrompt } = await import(path.join(WEB_SRC, 'engine', 'render', 'llmprompt.js'));
const { BASE_TEMPLATE, NAMING_CONFIG } = await import(path.join(WEB_SRC, 'engine', 'namingConfig.js'));
const { setPath } = await import(path.join(WEB_SRC, 'core', 'paths.js'));
// Same "today, local calendar day" default ui/steps/naming.js's own date
// input uses for an unanswered field (ui/questionControl.js) -- reused
// rather than reimplemented so this stays byte-identical to what typing
// nothing and accepting the app's own default would produce.
const { localDateInputValue } = await import(path.join(WEB_SRC, 'ui', 'questionControl.js'));

// Same aggregation rule as tools/serve_dir.py's _write_kb_dev_js and
// tools/build_single_file.py's _load_kb: every web/kb/*.json keyed by its
// filename stem, fed to shapeAppKb -- the exact shape main.js's
// loadAppKb()/globalThis.__MICRONAUT_KB__ produces.
function loadKbPack() {
  const raw = {};
  for (const f of readdirSync(KB_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    const stem = f.slice(0, -'.json'.length);
    raw[stem] = JSON.parse(readFileSync(path.join(KB_DIR, f), 'utf8'));
  }
  return shapeAppKb(raw);
}

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node tools/render_artifacts.mjs <out-dir>');
  process.exit(1);
}

const kb = loadKbPack();
const experiment = createDefaultStudy();

// A bench card is single-assay by design (overview.js's own comment on its
// per-assay download button). Of the example study's four assays, checked
// all four's real rendered output first (see the commit message): only
// "Intracellular ROS" has every channel fully resolved (DCF and DAPI both
// carry real Ex/Em peaks -- Macrophage cytoskeleton's bare "Phalloidin"
// resolves to state 'no-intrinsic-spectrum' and renders as
// "_(unresolved)_", Scratch/migration declares no markers at all) and the
// most complete control set (4, vs. 3 on Bacterial viability) -- the
// correctly demonstrative one of the four, not an arbitrary pick.
const BENCH_CARD_ASSAY_LABEL = 'Intracellular ROS';
const benchCardAssaySeed = experiment.assays.find((a) => a.label === BENCH_CARD_ASSAY_LABEL);
if (!benchCardAssaySeed) {
  console.error(`No assay labelled "${BENCH_CARD_ASSAY_LABEL}" in the example study.`);
  process.exit(1);
}
// naming.fields.date is deliberately NOT seeded anywhere in
// core/defaultStudy.js (see its own header comment: no real value exists
// without inventing one) -- an unanswered date renders every filename with
// NAMING_CONFIG's literal placeholder '1970-01-01', correct app behaviour
// but a jarring one to lead a promotional image with. Filling in today's
// date, the same default the app's own date input starts an unanswered
// field on, is what a researcher would do before acquiring -- not
// fabricated content, and every other field (magnification, markers,
// sample ID) is left exactly as the app produces it.
setPath(benchCardAssaySeed, 'naming.fields.date', localDateInputValue());

const doc = buildStudyDocument(experiment, kb, NAMING_CONFIG, BASE_TEMPLATE);
const conformance = checkConformance(experiment, kb, NAMING_CONFIG, BASE_TEMPLATE);
const experimentMap = buildExperimentMap(experiment, { conformance });
const triage = decisionTriage(experimentMap, conformance);

const benchCardAssay = doc.assays.find((a) => a.id === benchCardAssaySeed.id);
if (!benchCardAssay) {
  console.error(`Assay "${BENCH_CARD_ASSAY_LABEL}" disappeared while building the study document.`);
  process.exit(1);
}
const benchCardText = renderBenchCard(benchCardAssay);
const llmPromptText = renderLlmPrompt(doc, triage);

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'benchcard.md'), benchCardText, 'utf8');
writeFileSync(path.join(outDir, 'llmprompt.txt'), llmPromptText, 'utf8');

console.log(`wrote ${path.join(outDir, 'benchcard.md')} (${benchCardText.length} chars, assay "${benchCardAssay.label}")`);
console.log(`wrote ${path.join(outDir, 'llmprompt.txt')} (${llmPromptText.length} chars)`);
