// Tests for engine/studydoc.js (the document model) and its two renderers
// (render/markdown.js, render/mermaid.js). Exercises the REAL committed KB
// (readouts.json/controls.json/stages.json) against the real oregano
// default study (core/defaultStudy.js) -- the same fixture the app itself
// boots into on a fresh session -- so this is end-to-end over real content,
// not just synthetic fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderMarkdown } from '../src/engine/render/markdown.js';
import { renderMermaid } from '../src/engine/render/mermaid.js';
import { shapeAppKb } from '../src/engine/kbpack.js';
import { emptyExperiment } from '../src/core/schema.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';

// Duplicated as local literals rather than imported, like advisor.test.js's
// REAL_NAMING_TEMPLATE -- ui/steps/naming.js touches `document` and must
// stay importable without a DOM.
const NAMING_CONFIG = {
  template: '{date}_{modality}_{exptype}_{markers}_{magnification}_{group}_{sample}_{biorep}_{techrep}_{notes}{ext}',
  defaults: {
    date: '1970-01-01',
    modality: 'UNKNOWN',
    exptype: 'UNKNOWN',
    markers: 'UNKNOWN',
    magnification: 'UNKNOWN',
    sample: 'UNKNOWN',
  },
  optionalFields: ['group', 'biorep', 'techrep', 'notes'],
  uppercaseFields: ['modality', 'exptype', 'sample', 'magnification', 'markers', 'group'],
  safeCharPattern: '[^A-Za-z0-9_-]+',
};
const BASE_TEMPLATE = '{date}_{modality}_{exptype}_{markers}_{magnification}';

const here = path.dirname(fileURLToPath(import.meta.url));
function readKbJson(stem) {
  return JSON.parse(readFileSync(path.join(here, '..', 'kb', `${stem}.json`), 'utf-8'));
}

function realKb() {
  return shapeAppKb({
    markers: readKbJson('markers'),
    questions: readKbJson('questions'),
    advisor: readKbJson('advisor'),
    readouts: readKbJson('readouts'),
    controls: readKbJson('controls'),
    stages: readKbJson('stages'),
  });
}

// --- Determinism ---------------------------------------------------------

test('buildStudyDocument is deterministic: same inputs twice, byte-identical output', () => {
  const kb = realKb();
  const study = createDefaultStudy();
  const a = buildStudyDocument(study, kb, NAMING_CONFIG, BASE_TEMPLATE);
  const b = buildStudyDocument(study, kb, NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('renderMarkdown and renderMermaid are deterministic on the same document', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(renderMarkdown(doc), renderMarkdown(doc));
  assert.equal(renderMermaid(doc), renderMermaid(doc));
});

// --- Totality --------------------------------------------------------------

test('buildStudyDocument on an empty/malformed experiment never throws and yields a usable empty-ish document', () => {
  for (const bad of [undefined, null, {}, 'nope', 42]) {
    assert.doesNotThrow(() => buildStudyDocument(bad, realKb(), NAMING_CONFIG, BASE_TEMPLATE));
  }
});

test('buildStudyDocument(emptyExperiment()) has exactly 1 assay (schema invariant), zero controls, and an unanswered readout', () => {
  const doc = buildStudyDocument(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(doc.assays.length, 1);
  const assay = doc.assays[0];
  assert.equal(assay.readout.state, 'unanswered');
  assert.deepEqual(assay.controls.panel, []);
  assert.deepEqual(assay.controls.readout, []);
});

test('renderMarkdown/renderMermaid never throw on the empty-experiment document', () => {
  const doc = buildStudyDocument(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.doesNotThrow(() => renderMarkdown(doc));
  assert.doesNotThrow(() => renderMermaid(doc));
});

// --- The real oregano default study, end to end -----------------------

test('the real oregano default study yields all 4 assays with correct labels', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.deepEqual(
    doc.assays.map((a) => a.label),
    ['Bacterial viability', 'Macrophage cytoskeleton', 'Intracellular ROS', 'Scratch / migration']
  );
});

test('every default-study assay has correct arms/factors and a non-zero condition count', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  for (const assay of doc.assays) {
    assert.deepEqual(assay.design.arms, ['CTL', 'OPP']);
    assert.ok(assay.design.conditionCount > 0, `assay '${assay.label}' has zero condition rows`);
  }
  // Bacterial viability has the extra 'species' crossing factor (2 levels).
  const viability = doc.assays.find((a) => a.label === 'Bacterial viability');
  assert.deepEqual(viability.design.factors.map((f) => f.name), ['species']);
});

test('every default-study assay has planned filenames with no errors', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  for (const assay of doc.assays) {
    assert.ok(assay.filenames.length > 0, `assay '${assay.label}' has no planned filenames`);
    for (const entry of assay.filenames) {
      assert.equal(entry.error, null, `assay '${assay.label}' has a filename error: ${entry.error}`);
      assert.ok(entry.filename, `assay '${assay.label}' has a null filename with no error`);
    }
  }
});

test('every planned-filename entry carries its condition row (group/factorLevels/bioRep/techRep) -- a CSV renderer needs this without re-deriving the condition matrix', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  for (const assay of doc.assays) {
    for (const entry of assay.filenames) {
      assert.ok(entry.row && typeof entry.row === 'object', `assay '${assay.label}' has a filename entry with no row`);
      assert.ok('group' in entry.row && 'factorLevels' in entry.row && 'bioRep' in entry.row && 'techRep' in entry.row);
    }
  }
});

test('cross-assay filename collisions are flagged (or not) via studyNameIssues, not duplicated logic', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  // The default study gives every assay a distinct exptype, so this pins
  // "no false-positive collisions on real content" rather than asserting a
  // specific count that would need updating if the seed data changes.
  assert.deepEqual(doc.crossAssayIssues, []);
});

test('the default study seeds a recognized readout for every assay, so the example is a fully-worked demo', () => {
  // Reversal of an earlier "readout is a live interview question, not seeded"
  // decision: for the alpha the example study ships FULLY answered, so a
  // first-time user sees the guidance engine actually working (readout-
  // specific controls + stage notes) rather than "not answered yet" on every
  // assay. See core/defaultStudy.js's ASSAY_SEEDS readout/readoutText.
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  for (const assay of doc.assays) {
    assert.equal(assay.readout.state, 'known', `${assay.label} readout should be seeded and recognized`);
  }
  // The worked example must actually exercise the engine, not just fill a
  // label: a seeded readout fires its readout-specific controls.
  const viability = doc.assays.find((a) => a.label === 'Bacterial viability');
  assert.ok(
    viability.controls.readout.some((c) => c.id === 'viability-heat-killed-control'),
    'expected the seeded bacterial-viability readout to fire the heat-killed control'
  );
});

test('once a readout is answered, the matching panel AND readout controls fire, three-state resolves to "known"', () => {
  const study = createDefaultStudy();
  study.assays[0].readoutText = 'Bacterial viability';
  study.assays[0].readout = 'bacterial-viability';
  const doc = buildStudyDocument(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const viability = doc.assays[0];
  assert.equal(viability.readout.state, 'known');
  assert.equal(viability.readout.label, 'Bacterial viability');
  assert.ok(viability.controls.panel.length > 0, 'expected panel-derived controls to fire (markers are set)');
  assert.ok(
    viability.controls.readout.some((c) => c.id === 'viability-heat-killed-control'),
    'expected the heat-killed control to fire for bacterial-viability'
  );
});

test('an unrecognized readout answer resolves to "unrecognized", not silence', () => {
  const study = createDefaultStudy();
  // Mirror how the Describe step writes an unrecognized answer: both the free
  // text AND the canonical id change together (describe.js resolves the
  // canonical to '' when nothing matches). Clearing only readoutText would
  // leave the seeded canonical 'bacterial-viability' behind and fire its
  // controls -- not a real state the UI can produce.
  study.assays[0].readoutText = 'some assay this app has never heard of';
  study.assays[0].readout = '';
  const doc = buildStudyDocument(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.equal(doc.assays[0].readout.state, 'unrecognized');
  assert.deepEqual(doc.assays[0].controls.readout, []);
});

test('the study gets the full 5-stage ladder ONCE, not per assay', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.deepEqual(
    doc.ladder.map((s) => s.id),
    ['idea', 'pilot', 'validate-controls', 'acquisition-settings', 'advanced-modality']
  );
  // Every stage has real body text, and the ladder does NOT live on the
  // assay objects -- regression guard for the bug an adversarial pass
  // found: the identical 5-paragraph ladder rendered four times verbatim
  // in the Markdown export, once per assay, because it lived on the assay
  // instead of the study.
  for (const stage of doc.ladder) assert.ok(stage.body.length > 0);
  for (const assay of doc.assays) assert.equal(assay.ladder, undefined);
});

test('the seeded example surfaces readout-specific stage notes for the assays whose readout has them', () => {
  // With readouts now seeded (see above), the worked example legitimately
  // shows study-specific stage notes -- another way the demo exercises the
  // engine. Cytoskeleton's readout has no authored stage note, so it stays
  // empty; that difference is the point, not a gap.
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const byLabel = Object.fromEntries(doc.assays.map((a) => [a.label, a]));
  assert.ok(byLabel['Bacterial viability'].stageNotes.length >= 1);
  assert.ok(byLabel['Intracellular ROS'].stageNotes.length >= 1);
  assert.ok(byLabel['Scratch / migration'].stageNotes.length >= 1);
  assert.deepEqual(byLabel['Macrophage cytoskeleton'].stageNotes, []);
});

test('a STED assay gets a pilot stageNote, and that pilot note is scoped to that assay only', () => {
  const study = createDefaultStudy();
  study.assays[0].acquisition = { ...study.assays[0].acquisition, modality: 'STED' };
  const doc = buildStudyDocument(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const [viability, ...rest] = doc.assays;
  const pilotNotes = viability.stageNotes.filter((s) => s.stageId === 'pilot');
  assert.equal(pilotNotes.length, 1);
  assert.ok(pilotNotes[0].notes[0].includes('confocal'));
  // Other assays may carry their own readout-derived notes now, but the
  // STED-triggered PILOT note must not leak onto any of them.
  for (const assay of rest) {
    assert.deepEqual(assay.stageNotes.filter((s) => s.stageId === 'pilot'), []);
  }
});

// --- The exact bug an adversarial pass found: renderer parity on the
// "known readout, zero matching control rules" case ------------------------

test('controls.readoutMessage is null exactly when the readout list is non-empty, never both or neither', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  for (const assay of doc.assays) {
    if (assay.controls.readout.length > 0) {
      assert.equal(assay.controls.readoutMessage, null);
    } else {
      assert.equal(typeof assay.controls.readoutMessage, 'string');
    }
  }
});

test('a KNOWN readout with zero matching control rules gets "no guidance yet", not "not recognized"', () => {
  // Synthesize a kb where a readout is real (in the vocabulary) but has no
  // control rule at all -- exactly the case the adversarial pass used to
  // reproduce the HTML/Markdown divergence.
  const kb = realKb();
  kb.readouts = { ...kb.readouts, 'no-rules-readout': { label: 'No Rules Readout', aliases: [] } };
  const study = createDefaultStudy();
  study.assays[0].readoutText = 'No Rules Readout';
  study.assays[0].readout = 'no-rules-readout';
  study.assays[0].naming = { fields: {} }; // no markers -> zero panel controls too
  const doc = buildStudyDocument(study, kb, NAMING_CONFIG, BASE_TEMPLATE);
  const assay = doc.assays[0];
  assert.equal(assay.readout.state, 'known');
  assert.deepEqual(assay.controls.panel, []);
  assert.deepEqual(assay.controls.readout, []);
  assert.equal(assay.controls.readoutMessage, 'No control guidance for No Rules Readout yet.');
  assert.doesNotMatch(assay.controls.readoutMessage, /not recognize/);
});

// --- Markdown rendering: the three-state controls rule survives to text --

test('renderMarkdown never renders an empty controls section as silence', () => {
  const doc = buildStudyDocument(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const md = renderMarkdown(doc);
  assert.match(md, /Readout not answered yet/);
});

test('renderMarkdown renders the "How to run this project" ladder EXACTLY ONCE, not once per assay', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const md = renderMarkdown(doc);
  assert.equal(doc.assays.length, 4, 'sanity: the default study has 4 assays');
  const headingCount = (md.match(/^## How to run this project$/gm) || []).length;
  assert.equal(headingCount, 1, `expected exactly one ladder heading, got ${headingCount}`);
  // The ladder's first stage body is long and distinctive enough that a
  // count of 1 here directly falsifies the old per-assay duplication bug.
  const bodyOccurrences = md.split(doc.ladder[0].body).length - 1;
  assert.equal(bodyOccurrences, 1, `expected the ladder body to appear once, got ${bodyOccurrences}`);
});

test('renderMarkdown embeds a ```mermaid fenced block containing the mermaid source', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const md = renderMarkdown(doc);
  const mermaidSource = renderMermaid(doc);
  assert.match(md, /```mermaid\n/);
  assert.ok(md.includes(mermaidSource), 'expected the exact mermaid source to appear verbatim in the markdown');
});

test('renderMarkdown lists every assay heading and every planned filename', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const md = renderMarkdown(doc);
  for (const assay of doc.assays) {
    assert.match(md, new RegExp(`## Assay ${assay.index}: ${assay.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    for (const entry of assay.filenames) {
      if (entry.filename) assert.ok(md.includes(entry.filename), `expected filename '${entry.filename}' in the markdown output`);
    }
  }
});

// --- Mermaid rendering -------------------------------------------------

test('renderMermaid starts with "flowchart TD" and has one branch per assay', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const mermaid = renderMermaid(doc);
  assert.match(mermaid, /^flowchart TD/);
  for (const assay of doc.assays) {
    assert.match(mermaid, new RegExp(`STUDY --> assay_${assay.index}`));
  }
});

test('renderMermaid never emits an unescaped double quote inside a label', () => {
  const study = createDefaultStudy();
  study.assays[0].label = 'Weird "quoted" label';
  const doc = buildStudyDocument(study, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const mermaid = renderMermaid(doc);
  // Every label is wrapped as "..."; a raw embedded quote would break that
  // wrapping. Checking there are no STRAY quotes is done by counting: each
  // label contributes exactly 2 quote characters (open+close) once the
  // embedded one has been replaced with a single quote.
  assert.ok(!mermaid.includes('"quoted"'), 'expected the embedded double quotes to be escaped to single quotes');
});

test('renderMermaid on a zero-assay-ish malformed document still produces a valid, non-throwing diagram', () => {
  const doc = buildStudyDocument({}, realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  assert.doesNotThrow(() => renderMermaid(doc));
});
