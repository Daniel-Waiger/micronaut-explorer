// Tests for engine/kbpack.js's shapeAppKb -- the pure function that used to
// be unreachable inline code inside main.js's loadAppKb (main.js calls
// init() at module scope, so nothing there could ever be imported by a
// test). This file is the direct countermeasure to the class of bug this
// project has already shipped once: a new knowledge-pack key (here,
// 'advisor') silently going nowhere because nothing wired it up by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeAppKb } from '../src/engine/kbpack.js';
import { readKbJson, realKb } from './fixtures.js';

// A minimal, valid spectra pack -- reused by every test below that asserts
// `issues.length === 0` for an otherwise-complete raw object, so adding
// spectra wiring (PAN-3) doesn't force each of those tests to know its full
// shape just to stay issue-free.
const VALID_SPECTRA = {
  version: 1,
  fluorophores: {},
  overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20, reviewStatus: 'claude-drafted' },
};

function validAdvisorRule() {
  return {
    id: 'sted-photobleaching',
    surfaces: ['design'],
    kind: 'pitfall',
    concept: 'photobleaching',
    title: 'STED bleaches far faster than confocal',
    body: 'The depletion beam deposits far more energy per pixel than excitation alone, so photostability outweighs brightness.',
    when: { matches: ['acquisition.modality', '[Ss][Tt][Ee][Dd]'] },
    priority: 0,
  };
}

// --- The bug this module exists to prevent ---------------------------------

test('a raw.advisor pack reaches the returned advisor rules -- the exact wiring the allowOther bug lacked', () => {
  const { advisor, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    questions: [],
    advisor: { version: 1, rules: [validAdvisorRule()] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
    spectra: VALID_SPECTRA,
  });
  assert.equal(issues.length, 0);
  assert.equal(advisor.length, 1);
  assert.equal(advisor[0].id, 'sted-photobleaching');
});

// R3-13: shapeAppKb must expose the pack-level provenance loadAdvisorRules/
// loadControlRules now carry through, not stop at the array of rules --
// otherwise the loader-level fix has nowhere in the app to reach.
test('shapeAppKb exposes advisorReviewStatus/advisorNote and controlsReviewStatus/controlsNote', () => {
  const { advisorReviewStatus, advisorNote, controlsReviewStatus, controlsNote } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    questions: [],
    advisor: {
      version: 1,
      reviewStatus: 'source-cited',
      note: 'advisor note',
      rules: [validAdvisorRule()],
    },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, reviewStatus: 'source-cited', note: 'controls note', rules: [] },
    stages: { version: 1, stages: [], rules: [] },
    spectra: VALID_SPECTRA,
  });
  assert.equal(advisorReviewStatus, 'source-cited');
  assert.equal(advisorNote, 'advisor note');
  assert.equal(controlsReviewStatus, 'source-cited');
  assert.equal(controlsNote, 'controls note');
});

test('shapeAppKb over the REAL committed KB reports claude-drafted for both advisor and controls (R3-13)', () => {
  const { advisorReviewStatus, advisorNote, controlsReviewStatus, controlsNote } = realKb();
  assert.equal(advisorReviewStatus, 'claude-drafted');
  assert.equal(controlsReviewStatus, 'claude-drafted');
  assert.ok(typeof advisorNote === 'string' && advisorNote.length > 0);
  assert.ok(typeof controlsNote === 'string' && controlsNote.length > 0);
});

test('raw.questions passes through UNTOUCHED (createDescribeStep still owns loadQuestions itself)', () => {
  const rawQuestions = [{ id: 'q', field: 'a', type: 'text', priority: 1 }];
  const { questions } = shapeAppKb({ questions: rawQuestions });
  assert.deepEqual(questions, rawQuestions);
});

test('raw.readouts and raw.controls reach the returned readouts/controlRules -- the same wiring gap advisor once had', () => {
  const { readouts, controlRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    advisor: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
    readouts: { version: 1, readouts: { ros: { label: 'Intracellular ROS', aliases: ['dcf'] } } },
    controls: {
      version: 1,
      rules: [
        {
          id: 'ros-positive-control',
          kind: 'readout',
          title: 'H2O2-treated positive control',
          why: 'A hydrogen-peroxide-treated sample gives DCF a known, strong oxidative signal before trusting a subtler one.',
          when: { eq: ['readout', 'ros'] },
          priority: 0,
        },
      ],
    },
    spectra: VALID_SPECTRA,
  });
  assert.equal(issues.length, 0);
  assert.deepEqual(readouts.ros, { label: 'Intracellular ROS', aliases: ['dcf'] });
  assert.equal(controlRules.length, 1);
  assert.equal(controlRules[0].id, 'ros-positive-control');
});

test('missing raw.readouts/raw.controls degrade to empty shapes plus issues, never silence or a throw', () => {
  const { readouts, controlRules, issues } = shapeAppKb({});
  assert.deepEqual(readouts, {});
  assert.deepEqual(controlRules, []);
  assert.ok(issues.some((i) => /readouts pack is missing/.test(i.message)));
  assert.ok(issues.some((i) => /controls pack is missing/.test(i.message)));
});

test('raw.stages reaches the returned stages/stageRules -- the same wiring gap advisor once had', () => {
  const { stages, stageRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    advisor: { version: 1, rules: [] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: {
      version: 1,
      stages: [{ id: 'idea', order: 10, title: 'Idea', body: 'x'.repeat(40) }],
      rules: [{ id: 'note-1', stage: 'idea', when: { exists: 'researchQuestion' }, note: 'y'.repeat(40), priority: 0 }],
    },
    spectra: VALID_SPECTRA,
  });
  assert.equal(issues.length, 0);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].id, 'idea');
  assert.equal(stageRules.length, 1);
  assert.equal(stageRules[0].id, 'note-1');
});

test('missing raw.stages degrades to empty shapes plus an issue, never silence or a throw', () => {
  const { stages, stageRules, issues } = shapeAppKb({});
  assert.deepEqual(stages, []);
  assert.deepEqual(stageRules, []);
  assert.ok(issues.some((i) => /stages pack is missing/.test(i.message)));
});

// --- Totality: every combination of absent/malformed input degrades cleanly

test('a raw object with every sub-pack present yields zero issues', () => {
  const { index, questions, advisor, readouts, controlRules, stages, stageRules, spectra, overlapRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    questions: [],
    advisor: { version: 1, rules: [] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
    spectra: VALID_SPECTRA,
  });
  assert.deepEqual(questions, []);
  assert.deepEqual(advisor, []);
  assert.deepEqual(readouts, {});
  assert.deepEqual(controlRules, []);
  assert.deepEqual(stages, []);
  assert.deepEqual(stageRules, []);
  assert.deepEqual(spectra, {});
  assert.equal(overlapRules.emissionProximityNm, 25);
  assert.equal(overlapRules.schematicEmissionFwhmNm, 50);
  assert.deepEqual(issues, []);
  assert.ok(index); // indexKb's own shape, exercised by kb.test.js
});

// --- raw.spectra + markersKb wiring (PAN-3): the same wiring gap advisor once had

test('raw.spectra reaches the returned spectra/overlapRules -- the same wiring gap advisor once had', () => {
  const { spectra, overlapRules, issues } = shapeAppKb({
    markers: { version: 1, markers: {}, ambiguousInFreeText: [] },
    advisor: { version: 1, rules: [] },
    readouts: { version: 1, readouts: {} },
    controls: { version: 1, rules: [] },
    stages: { version: 1, stages: [], rules: [] },
    spectra: {
      version: 1,
      overlapRules: {
        emissionProximityNm: 25,
        excitationProximityNm: 20,
        schematicEmissionFwhmNm: 64,
        reviewStatus: 'claude-drafted',
      },
      fluorophores: { DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, reviewStatus: 'claude-drafted' } },
    },
  });
  assert.equal(issues.length, 0);
  assert.ok(spectra.DYEA);
  assert.equal(overlapRules.emissionProximityNm, 25);
  assert.equal(overlapRules.schematicEmissionFwhmNm, 64);
});

test('the real generated marker and spectra packs expose the representative fluorophore expansion', () => {
  assert.doesNotThrow(() => realKb());

  // These are the committed generated packs, loaded through the same
  // shapeAppKb boundary as the application. Expected peaks and variants
  // come from those files rather than a fallback copy in this test.
  const rawMarkers = readKbJson('markers');
  const rawSpectra = readKbJson('spectra');
  const kb = realKb();
  assert.deepEqual(kb.issues, []);

  const directCanonicals = [
    'ALEXA790',
    'ATTO740',
    'CF790',
    'DYLIGHT800',
    'MSCARLET3',
    'MIRFP720',
    'LIPIDTOXDEEPRED',
    'TOPRO5',
    'CELLROXDEEPRED',
    'PHRODORED',
    'IRDYE800CW',
  ];
  for (const canonical of directCanonicals) {
    assert.ok(rawMarkers.markers[canonical], `${canonical} must be generated in markers.json`);
    assert.ok(rawSpectra.fluorophores[canonical], `${canonical} must be present in spectra.json`);
    assert.deepEqual(kb.markersKb.markers[canonical], rawMarkers.markers[canonical]);
    assert.equal(
      kb.spectra[canonical].excitationPeakNm,
      rawSpectra.fluorophores[canonical].excitationPeakNm,
      `${canonical} excitation`
    );
    assert.equal(
      kb.spectra[canonical].emissionPeakNm,
      rawSpectra.fluorophores[canonical].emissionPeakNm,
      `${canonical} emission`
    );
  }

  const newFamilyVariants = {
    LYSOTRACKER: ['lysotracker blue', 'lysotracker yellow', 'lysotracker deep red'],
    LIVEDEAD: ['livedead aqua', 'livedead yellow', 'livedead near ir'],
    SYTO: ['syto 40', 'syto 41', 'syto 42', 'syto 45', 'syto rnaselect'],
  };
  for (const [canonical, variants] of Object.entries(newFamilyVariants)) {
    for (const variant of variants) {
      assert.ok(kb.markersKb.markers[canonical].variants.includes(variant), `${canonical}: ${variant}`);
      assert.deepEqual(
        kb.spectra[canonical].variants[variant],
        rawSpectra.fluorophores[canonical].variants[variant],
        `${canonical} spectrum: ${variant}`
      );
    }
  }

  const representativeAliases = {
    'Alexa Fluor 790': 'ALEXA790',
    'ATTO 740': 'ATTO740',
    'CF 790': 'CF790',
    'DyLight 800': 'DYLIGHT800',
    'mScarlet-I': 'MSCARLETI',
    'IRDye 800CW': 'IRDYE800CW',
    'LysoTracker Deep Red': 'LYSOTRACKER',
    'LIVE-DEAD Near IR': 'LIVEDEAD',
    'SYTO RNASelect': 'SYTO',
  };
  for (const [alias, canonical] of Object.entries(representativeAliases)) {
    assert.equal(kb.index.aliasToCanonical.get(alias.toLowerCase()), canonical, alias);
  }
});

test('missing raw.spectra degrades to an empty shape plus an issue, never silence or a throw', () => {
  const { spectra, overlapRules, issues } = shapeAppKb({});
  assert.deepEqual(spectra, {});
  assert.ok(overlapRules.emissionProximityNm > 0); // safe default, not a throw
  assert.ok(issues.some((i) => /spectra pack is missing/.test(i.message)));
});

test("markersKb (loadKb's own {version, markers, ambiguousInFreeText} shape) is exposed, not discarded after building the index", () => {
  const { markersKb } = shapeAppKb({
    markers: { version: 1, markers: { DYEA: { aliases: ['dyea'], class: 'dye', isFamily: false, variants: [] } }, ambiguousInFreeText: [] },
  });
  assert.ok(markersKb);
  assert.ok(markersKb.markers.DYEA);
  assert.equal(markersKb.markers.DYEA.class, 'dye');
});

test('a genuinely empty raw object ({}) reports BOTH sub-packs missing, not silence', () => {
  const { questions, advisor, issues } = shapeAppKb({});
  assert.deepEqual(questions, []);
  assert.deepEqual(advisor, []);
  assert.ok(issues.some((i) => /knowledge pack is missing/.test(i.message)));
  assert.ok(issues.some((i) => /advisor pack is missing/.test(i.message)));
});

test('undefined/null/non-object raw never throws and degrades to the same empty shape', () => {
  for (const raw of [undefined, null, 'nope', 42, []]) {
    const { questions, advisor, issues } = shapeAppKb(raw);
    assert.deepEqual(questions, []);
    assert.deepEqual(advisor, []);
    // Missing markers pack is a real ('fatal') issue in loadKb; that is
    // pre-existing behaviour this module must not change.
    assert.ok(issues.length >= 1, String(raw));
  }
});

test('a missing raw.advisor key reports the advisor "pack is missing" issue, not silence', () => {
  const { advisor, issues } = shapeAppKb({ markers: { version: 1, markers: {}, ambiguousInFreeText: [] } });
  assert.deepEqual(advisor, []);
  assert.ok(issues.some((i) => /advisor pack is missing/.test(i.message)));
});

// --- issues merges both sub-packs into one list for a single caller count --

test('issues merges marker-pack AND advisor-pack issues into one array', () => {
  const { issues } = shapeAppKb({
    markers: { version: 99 }, // wrong version -> fatal marker issue
    advisor: { rules: [{ id: 'bad kind bad' }] }, // -> at least one advisor issue
  });
  assert.ok(issues.some((i) => /knowledge pack version/.test(i.message)), 'expected the marker issue');
  assert.ok(issues.some((i) => i.field !== undefined), 'expected at least one advisor-shaped issue with a field');
});

test('shapeAppKb never mutates the raw object it is given', () => {
  const raw = { markers: { version: 1, markers: {}, ambiguousInFreeText: [] }, questions: [], advisor: { rules: [] } };
  const before = JSON.stringify(raw);
  shapeAppKb(raw);
  assert.equal(JSON.stringify(raw), before);
});
