// Shapes the raw globalThis.__MICRONAUT_KB__ object into what the app
// actually consumes: the marker index, the raw question bank, and the
// loaded advisor rules.
//
// This exists so that "did we remember to wire up a new KB key" stops being
// an untestable claim. Before this module, that wiring lived inline inside
// main.js's loadAppKb, and main.js calls init() at module scope -- so
// loadAppKb could never be imported by a test. The project has already
// shipped the failure mode this structurally prevents: a new question-bank
// property (allowOther) was silently dropped by a whitelist one layer down
// because nothing exercised the wiring in isolation. shapeAppKb is a pure
// function of `raw`, so "does web/kb/advisor.json actually reach selectAdvice"
// is now a two-line test (see web/tests/kbpack.test.js) instead of a hope.
//
// Pure module: no DOM, no globals read here (the global read stays in
// main.js, the one place that is allowed to touch globalThis).

import { indexKb, loadKb } from '../core/kb.js';
import { loadAdvisorRules } from './advisor.js';
import { loadControlRules, loadReadouts } from './controls.js';
import { loadStages } from './stages.js';
import { loadSpectraKb } from './spectra.js';

/**
 * Shape the raw KB object into { index, markersKb, questions, advisor,
 * readouts, controlRules, stages, stageRules, spectra, overlapRules, issues }.
 *
 * `raw` is globalThis.__MICRONAUT_KB__ (or an already-defaulted `{}`):
 * an object keyed by filename stem -- `raw.markers`, `raw.questions`,
 * `raw.advisor`, `raw.readouts`, `raw.controls`, `raw.stages`, `raw.spectra`
 * -- aggregated at build/dev time from web/kb/*.json.
 *
 * `markersKb` is `loadKb`'s own `{version, markers, ambiguousInFreeText}`
 * shape -- previously computed here and immediately discarded once `index`
 * was built from it. engine/spectra.js's resolveMarkerToken needs it (via
 * core/kb.js's kbMarker) to read a marker's `class`/`isFamily`, so it is now
 * part of the returned shape rather than a second, redundant loadKb() call
 * a future caller might otherwise be tempted to make.
 *
 * TOTAL, like every loader it composes: a missing or malformed `raw`, or any
 * missing key on it, degrades to a usable empty shape plus issues, never a
 * throw. `issues` merges every sub-pack's issues into one list so a caller
 * that only wants a single count (main.js's toast) does not need to know
 * how many sub-packs exist.
 */
export function shapeAppKb(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const { kb: markersKb, issues: markerIssues } = loadKb(source.markers);
  const index = indexKb(markersKb);
  const questions = Array.isArray(source.questions) ? source.questions : [];
  const { rules: advisor, issues: advisorIssues } = loadAdvisorRules(source.advisor);
  const { readouts, issues: readoutIssues } = loadReadouts(source.readouts);
  const { rules: controlRules, issues: controlIssues } = loadControlRules(source.controls);
  const { stages, rules: stageRules, issues: stageIssues } = loadStages(source.stages);
  const { fluorophores: spectra, overlapRules, issues: spectraIssues } = loadSpectraKb(source.spectra);

  return {
    index,
    markersKb,
    questions,
    advisor,
    readouts,
    controlRules,
    stages,
    stageRules,
    spectra,
    overlapRules,
    issues: [...markerIssues, ...advisorIssues, ...readoutIssues, ...controlIssues, ...stageIssues, ...spectraIssues],
  };
}
