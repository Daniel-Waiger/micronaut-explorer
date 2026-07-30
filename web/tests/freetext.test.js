import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseFreeText } from '../src/engine/freetext.js';
import { indexKb, loadKb } from '../src/core/kb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kbPath = path.join(here, '..', 'kb', 'markers.json');
const fixturePath = path.join(here, '..', '..', 'tests', 'fixtures', 'freetext_conformance.json');

const rawKb = JSON.parse(readFileSync(kbPath, 'utf-8'));
const { kb, issues: kbIssues } = loadKb(rawKb);
const index = indexKb(kb);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8'));

function markersFrom(result) {
  const markerProposal = result.proposals.find((p) => p.path === 'naming.fields.markers');
  return markerProposal ? new Set(markerProposal.value.split('-')) : new Set();
}

test('the real web/kb/markers.json loads with zero issues (sanity check for the fixtures below)', () => {
  assert.deepEqual(kbIssues, []);
});

test('conformance fixtures: parseFreeText finds exactly the expected marker SET', () => {
  for (const { note, text, expectedMarkers } of fixtures) {
    const result = parseFreeText(text, index);
    const found = markersFrom(result);
    const expected = new Set(expectedMarkers);
    assert.deepEqual(found, expected, `${note}\ntext: ${text}`);
  }
});

test('B2/B3 overlap resolution: ATTO 647-N and ATTO 647 both surface, not just one', () => {
  const result = parseFreeText('ch1 ATTO 647-N ch2 ATTO 647', index);
  const markerProposal = result.proposals.find((p) => p.path === 'naming.fields.markers');
  assert.ok(markerProposal, 'expected a markers proposal');
  assert.equal(markerProposal.value, 'ATTO647N-ATTO647');
  const canonicals = markerProposal.matches.map((m) => m.canonical);
  assert.deepEqual(canonicals, ['ATTO647N', 'ATTO647']);
});

test('AMBIGUOUS_IN_FREE_TEXT: a sentence built entirely of ambiguous words proposes zero markers', () => {
  const result = parseFreeText('we took a snap of the halo around the tomato explant', index);
  assert.equal(result.proposals.find((p) => p.path === 'naming.fields.markers'), undefined);
});

test('the same ambiguous words ARE real hits when spelled as an unambiguous alias', () => {
  const result = parseFreeText('Cells labeled with HaloTag and SNAP-tag constructs.', index);
  const found = markersFrom(result);
  assert.deepEqual(found, new Set(['HALO', 'SNAP']));
});

test('replicates: n=3, "n = 3", "3 replicates", and "triplicate" all yield 3', () => {
  for (const text of ['n=3', 'n = 3', '3 replicates', 'we ran this in triplicate']) {
    const result = parseFreeText(text, index);
    const replicateProposal = result.proposals.find((p) => p.path === 'design.replicates');
    assert.ok(replicateProposal, `expected a replicates proposal for: ${text}`);
    assert.equal(replicateProposal.value, 3, `for: ${text}`);
  }
});

test('replicates: "duplicate" yields 2', () => {
  const result = parseFreeText('samples were run in duplicate', index);
  const replicateProposal = result.proposals.find((p) => p.path === 'design.replicates');
  assert.equal(replicateProposal.value, 2);
});

test('magnification: 63x, 63X, and x63 all normalize to X63', () => {
  for (const text of ['imaged at 63x', 'imaged at 63X', 'imaged at x63']) {
    const result = parseFreeText(text, index);
    const magProposal = result.proposals.find((p) => p.path === 'naming.fields.magnification');
    assert.ok(magProposal, `expected a magnification proposal for: ${text}`);
    assert.equal(magProposal.value, 'X63', `for: ${text}`);
  }
});

test('magnification: a keyword-anchored value is also recognized', () => {
  const result = parseFreeText('Objective: 40, oil immersion', index);
  const magProposal = result.proposals.find((p) => p.path === 'naming.fields.magnification');
  assert.equal(magProposal.value, 'X40');
});

test('date: an ISO date is proposed', () => {
  const result = parseFreeText('Acquired on 2026-07-30 in the morning.', index);
  const dateProposal = result.proposals.find((p) => p.path === 'naming.fields.date');
  assert.ok(dateProposal);
  assert.equal(dateProposal.value, '2026-07-30');
});

test('date: an ambiguous non-ISO date (03/04/2026) is NOT proposed', () => {
  const result = parseFreeText('Acquired on 03/04/2026.', index);
  const dateProposal = result.proposals.find((p) => p.path === 'naming.fields.date');
  assert.equal(dateProposal, undefined);
});

test('every proposal is tagged freetext with a non-empty evidence substring genuinely at its index', () => {
  const text = 'Confocal at 63x on 2026-07-30, DAPI staining, n=3.';
  const result = parseFreeText(text, index);
  assert.ok(result.proposals.length > 0);
  for (const proposal of result.proposals) {
    assert.equal(proposal.tag, 'freetext');
    assert.ok(typeof proposal.evidence === 'string' && proposal.evidence.length > 0);
    assert.equal(
      text.slice(proposal.index, proposal.index + proposal.evidence.length),
      proposal.evidence,
      `evidence for ${proposal.path} must be the real substring at its stated index`
    );
  }
});

test('unmatched lists fields that produced no proposal', () => {
  const result = parseFreeText('nothing extractable here', index);
  assert.ok(result.unmatched.includes('markers'));
  assert.ok(result.unmatched.includes('replicates'));
  assert.ok(result.unmatched.includes('magnification'));
  assert.ok(result.unmatched.includes('date'));
});

test('parseFreeText is total: non-string text and a malformed index do not throw', () => {
  assert.doesNotThrow(() => parseFreeText(undefined, index));
  assert.doesNotThrow(() => parseFreeText(null, index));
  assert.doesNotThrow(() => parseFreeText('some text', null));
  assert.doesNotThrow(() => parseFreeText('some text', undefined));
  assert.doesNotThrow(() => parseFreeText('', {}));
});

test('the module never writes to any store (no store import, no setPath call)', () => {
  const source = readFileSync(path.join(here, '..', 'src', 'engine', 'freetext.js'), 'utf-8');
  assert.ok(!/from ['"].*store\.js['"]/.test(source), 'must not import core/store.js');
  assert.ok(!/\bsetPath\s*\(/.test(source), 'must not call setPath');
});
