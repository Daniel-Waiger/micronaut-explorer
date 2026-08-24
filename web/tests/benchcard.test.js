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
  assert.match(card, /# Measurement bench card -- Bacterial viability/);
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
      filterCenterNm: index === 0 ? 620 : null,
      filterBandwidthNm: index === 0 ? 40 : null,
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
  assert.ok(card.includes('| mScarlet-I | 569/593 | 620/40 |'));
  assert.ok(card.includes('| IRDye 800CW | 774/789 | _(not set)_ |'));

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

test('detection filters are explicit and malformed or absent values never become invented defaults', () => {
  const card = renderBenchCard({
    label: 'Filter contract',
    panelRows: [
      { target: '', fluorophore: 'A', excitationPeakNm: 480, emissionPeakNm: 520, filterCenterNm: 525, filterBandwidthNm: 50 },
      { target: '', fluorophore: 'B', excitationPeakNm: 550, emissionPeakNm: 590, filterCenterNm: 600, filterBandwidthNm: null },
      { target: '', fluorophore: 'C', excitationPeakNm: null, emissionPeakNm: null, filterCenterNm: '650', filterBandwidthNm: 40 },
    ],
    controls: {},
    filenames: [],
  });
  assert.ok(card.includes('| A | 480/520 | 525/50 |'));
  assert.ok(card.includes('| B | 550/590 | _(not set)_ |'));
  assert.ok(card.includes('| C | _(unresolved)_ | _(not set)_ |'));
});

test('never throws on a missing/malformed assay, and says so plainly', () => {
  assert.doesNotThrow(() => renderBenchCard(undefined));
  assert.doesNotThrow(() => renderBenchCard(null));
  assert.doesNotThrow(() => renderBenchCard('not an object'));
  assert.match(renderBenchCard(undefined), /No such measurement/);
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
