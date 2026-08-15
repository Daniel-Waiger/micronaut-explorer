// Tests for engine/render/benchcard.js -- the single-assay, print-oriented
// bench card renderer (Wave 2B, alpha-pilot-readiness).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyDocument } from '../src/engine/studydoc.js';
import { renderBenchCard } from '../src/engine/render/benchcard.js';
import { createDefaultStudy } from '../src/core/defaultStudy.js';
import { emptyExperiment } from '../src/core/schema.js';
import { NAMING_CONFIG, BASE_TEMPLATE, readKbJson, realKb } from './fixtures.js';

test('renders modality, specimen, readout, a channel table, controls with reasons, and two worked filenames for a real assay', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const viability = doc.assays.find((a) => a.label === 'Bacterial viability');
  const card = renderBenchCard(viability);
  assert.match(card, /# Bench card -- Bacterial viability/);
  assert.match(card, /\*\*Modality:\*\* confocal/);
  assert.match(card, /\*\*Readout:\*\* Bacterial viability/);
  assert.match(card, /\| SYTO9 \|/);
  assert.match(card, /\| PROPIDIUM IODIDE \|/);
  assert.match(card, /Unstained \/ autofluorescence control/);
  assert.match(card, /Heat-killed \(dead\) control/);
  // Two worked filename examples, not the whole list.
  const backtickLines = card.split('\n').filter((l) => l.startsWith('`'));
  assert.equal(backtickLines.length, 2);
});

test('renders the mixed expanded panel using KB-derived study-document peaks', () => {
  const study = createDefaultStudy();
  const fluorophores = ['mScarlet-I', 'IRDye 800CW', 'CellROX Deep Red', 'LysoTracker Deep Red'];
  study.assays[0].panel = {
    targets: [],
    channels: fluorophores.map((fluorophore, index) => ({
      id: `expanded-${index + 1}`,
      target: `Target ${index + 1}`,
      fluorophore,
      conjugation: 'direct-probe',
      conjugateDye: '',
    })),
  };

  const kb = realKb();
  const assay = buildStudyDocument(study, kb, NAMING_CONFIG, BASE_TEMPLATE).assays[0];
  const card = renderBenchCard(assay);
  const rawSpectra = readKbJson('spectra').fluorophores;
  const expectedByName = {
    'mScarlet-I': rawSpectra.MSCARLETI,
    'IRDye 800CW': rawSpectra.IRDYE800CW,
    'CellROX Deep Red': rawSpectra.CELLROXDEEPRED,
    'LysoTracker Deep Red': rawSpectra.LYSOTRACKER.variants['lysotracker deep red'],
  };

  for (const fluorophore of fluorophores) {
    const expected = expectedByName[fluorophore];
    assert.ok(
      card.includes(`| ${fluorophore} | ${expected.excitationPeakNm}/${expected.emissionPeakNm} |`),
      `bench card must render the real KB peaks for ${fluorophore}`
    );
  }

  // A changed runtime spectrum must flow through the document into the
  // rendered card; matching only the committed values would not disprove
  // a hard-coded consumer.
  kb.spectra.IRDYE800CW.excitationPeakNm = rawSpectra.IRDYE800CW.excitationPeakNm + 1;
  kb.spectra.IRDYE800CW.emissionPeakNm = rawSpectra.IRDYE800CW.emissionPeakNm + 1;
  const changedAssay = buildStudyDocument(study, kb, NAMING_CONFIG, BASE_TEMPLATE).assays[0];
  const changedCard = renderBenchCard(changedAssay);
  assert.ok(
    changedCard.includes(
      `| IRDye 800CW | ${rawSpectra.IRDYE800CW.excitationPeakNm + 1}/${rawSpectra.IRDYE800CW.emissionPeakNm + 1} |`
    )
  );
});

test('never throws on a missing/malformed assay, and says so plainly', () => {
  assert.doesNotThrow(() => renderBenchCard(undefined));
  assert.doesNotThrow(() => renderBenchCard(null));
  assert.doesNotThrow(() => renderBenchCard('not an object'));
  assert.match(renderBenchCard(undefined), /No such assay/);
});

test('an assay with zero channels/controls/filenames states each gap explicitly, never a blank section', () => {
  const doc = buildStudyDocument(emptyExperiment(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const card = renderBenchCard(doc.assays[0]);
  assert.match(card, /No channels declared yet/);
  assert.match(card, /No controls recommended yet/);
});

test('deterministic: same assay in, byte-identical card out', () => {
  const doc = buildStudyDocument(createDefaultStudy(), realKb(), NAMING_CONFIG, BASE_TEMPLATE);
  const assay = doc.assays[0];
  assert.equal(renderBenchCard(assay), renderBenchCard(assay));
});
