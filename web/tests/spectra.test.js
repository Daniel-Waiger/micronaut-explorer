// Tests for engine/spectra.js: the spectral-KB loader (mirrors advisor.js/
// controls.js's discipline), the five-state marker-token resolver, the
// whole-field resolver, and the pairwise qualitative overlap evaluator.
// Built and tested against SYNTHETIC fixtures only (PAN-2) -- committed-
// content guards for the REAL web/kb/spectra.json live in kbpack.test.js
// (PAN-3), mirroring advisor.test.js/controls.test.js's split.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadKb, indexKb } from '../src/core/kb.js';
import { derivePanelFacts, flagPanelOverlaps, loadSpectraKb, resolveMarkerToken, resolvePanel, SPECTRAL_STATES } from '../src/engine/spectra.js';

// A small, self-consistent synthetic marker KB: one plain dye (ALEXA488-like),
// one family with two variants (a MitoTracker-like), one tag (a HaloTag-
// like), one moiety (a phalloidin-like), and one dye with NO spectra entry
// (a content-gap stand-in).
function markerKbFixture() {
  return loadKb({
    version: 1,
    markers: {
      DYEA: { aliases: ['dyea'], freeTextAliases: ['dyea'], class: 'dye', isFamily: false, variants: [] },
      DYEB: { aliases: ['dyeb'], freeTextAliases: ['dyeb'], class: 'dye', isFamily: false, variants: [] },
      DYEGAP: { aliases: ['dyegap'], freeTextAliases: ['dyegap'], class: 'dye', isFamily: false, variants: [] },
      FAMILYDYE: {
        aliases: ['familydye', 'familydye red', 'familydye green'],
        freeTextAliases: ['familydye', 'familydye red', 'familydye green'],
        class: 'dye',
        isFamily: true,
        variants: ['familydye red', 'familydye green'],
      },
      TAGX: { aliases: ['tagx'], freeTextAliases: ['tagx'], class: 'tag', isFamily: false, variants: [] },
      MOIETYX: { aliases: ['moietyx'], freeTextAliases: ['moietyx'], class: 'moiety', isFamily: false, variants: [] },
      // An antibody TARGET (e.g. Sox2) -- distinct from MOIETYX (a
      // direct-conjugate probe, no antibody involved). derivePanelFacts's
      // hasAntibody must key on THIS class, not 'moiety'.
      TARGETX: { aliases: ['targetx'], freeTextAliases: ['targetx'], class: 'target', isFamily: false, variants: [] },
      // A hyphenated-alias stand-in (mirrors the real KB's 'calcein-am',
      // 'fura-2', 'texas-red', ...): splitMarkers's own delimiter set
      // includes '-', so this alias can ONLY be reached via resolvePanel's
      // rejoin pass, never via a single splitMarkers token.
      HYDYE: { aliases: ['hy-dye'], freeTextAliases: ['hy-dye'], class: 'dye', isFamily: false, variants: [] },
    },
    ambiguousInFreeText: [],
  }).kb;
}

function spectraFixture() {
  return loadSpectraKb({
    version: 1,
    overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20, reviewStatus: 'claude-drafted' },
    fluorophores: {
      DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, reviewStatus: 'claude-drafted' },
      DYEB: { excitationPeakNm: 493, emissionPeakNm: 518, reviewStatus: 'claude-drafted' },
      FAMILYDYE: {
        isFamily: true,
        reviewStatus: 'claude-drafted',
        variants: {
          'familydye red': { excitationPeakNm: 579, emissionPeakNm: 599 },
          'familydye green': { excitationPeakNm: 490, emissionPeakNm: 516 },
        },
      },
      // DYEGAP deliberately has NO entry here -- the content-gap stand-in.
      HYDYE: { excitationPeakNm: 550, emissionPeakNm: 570, reviewStatus: 'claude-drafted' },
    },
  }).fluorophores;
}

function fixtures() {
  const markersKb = markerKbFixture();
  const markerIndex = indexKb(markersKb);
  const fluorophores = spectraFixture();
  return { markersKb, markerIndex, fluorophores };
}

// --- loadSpectraKb: shape and totality --------------------------------------

test('a well-formed pack loads with zero issues', () => {
  const { fluorophores, overlapRules, issues } = loadSpectraKb({
    version: 1,
    overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20, reviewStatus: 'claude-drafted' },
    fluorophores: { DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, reviewStatus: 'claude-drafted' } },
  });
  assert.equal(issues.length, 0);
  assert.equal(overlapRules.emissionProximityNm, 25);
  assert.equal(overlapRules.excitationProximityNm, 20);
  assert.equal(overlapRules.schematicEmissionFwhmNm, 50);
  assert.deepEqual(fluorophores.DYEA, { isFamily: false, reviewStatus: 'claude-drafted', excitationPeakNm: 490, emissionPeakNm: 525 });
});

test('an absent or malformed pack (undefined/null/array/string) reports an issue, never throws', () => {
  for (const raw of [undefined, null, [], 'nope']) {
    const { fluorophores, overlapRules, issues } = loadSpectraKb(raw);
    assert.deepEqual(fluorophores, {});
    assert.ok(overlapRules.emissionProximityNm > 0);
    assert.ok(issues.length > 0, String(raw));
  }
});

test('a wrong version is reported but does not throw', () => {
  const { issues } = loadSpectraKb({ version: 2, fluorophores: {} });
  assert.match(issues[0].message, /version is 2, expected 1/);
});

test('an unrecognized top-level key on a fluorophore entry is REPORTED but does not drop the entry', () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    fluorophores: { DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, bogus: true } },
  });
  assert.ok(fluorophores.DYEA);
  assert.match(issues[0].message, /unrecognized property 'bogus'/);
});

test('a fluorophore entry missing numeric peaks is dropped and reported, others survive', () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    fluorophores: {
      GOOD: { excitationPeakNm: 490, emissionPeakNm: 525 },
      BAD: { excitationPeakNm: 'nope' },
    },
  });
  assert.ok(fluorophores.GOOD);
  assert.equal(fluorophores.BAD, undefined);
  assert.ok(issues.some((i) => i.field === 'BAD' && /missing numeric/.test(i.message)));
});

test('an implausible peak pair (out of range, or emission <= excitation) is dropped and reported, others survive', () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    fluorophores: {
      GOOD: { excitationPeakNm: 490, emissionPeakNm: 525 },
      TRANSPOSED: { excitationPeakNm: 525, emissionPeakNm: 490 }, // emission <= excitation: impossible Stokes shift
      TOOLOW: { excitationPeakNm: 100, emissionPeakNm: 150 }, // below the visible/near-UV floor
      TOOHIGH: { excitationPeakNm: 850, emissionPeakNm: 950 }, // above the near-IR ceiling
      EQUAL: { excitationPeakNm: 500, emissionPeakNm: 500 }, // zero Stokes shift: also impossible
    },
  });
  assert.ok(fluorophores.GOOD);
  for (const bad of ['TRANSPOSED', 'TOOLOW', 'TOOHIGH', 'EQUAL']) {
    assert.equal(fluorophores[bad], undefined, bad);
    assert.ok(
      issues.some((i) => i.field === bad && /implausible/.test(i.message)),
      bad
    );
  }
});

test("a family variant with an implausible peak pair is dropped and reported, sibling variants survive", () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    fluorophores: {
      FAM: {
        isFamily: true,
        variants: {
          'fam red': { excitationPeakNm: 579, emissionPeakNm: 599 },
          'fam transposed': { excitationPeakNm: 599, emissionPeakNm: 579 },
        },
      },
    },
  });
  assert.ok(fluorophores.FAM.variants['fam red']);
  assert.equal(fluorophores.FAM.variants['fam transposed'], undefined);
  assert.ok(issues.some((i) => i.field === 'FAM' && /variant 'fam transposed' has an implausible/.test(i.message)));
});

test('a valid emissionFwhmNm is kept on both a direct entry and a family variant', () => {
  const { fluorophores } = loadSpectraKb({
    version: 1,
    fluorophores: {
      DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, emissionFwhmNm: 40 },
      FAM: { isFamily: true, variants: { 'fam red': { excitationPeakNm: 579, emissionPeakNm: 599, emissionFwhmNm: 55 } } },
    },
  });
  assert.equal(fluorophores.DYEA.emissionFwhmNm, 40);
  assert.equal(fluorophores.FAM.variants['fam red'].emissionFwhmNm, 55);
});

test('a missing emissionFwhmNm is simply absent, never a fabricated default, and reports no issue', () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20, reviewStatus: 'claude-drafted' },
    fluorophores: { DYEA: { excitationPeakNm: 490, emissionPeakNm: 525 } },
  });
  assert.equal('emissionFwhmNm' in fluorophores.DYEA, false);
  assert.equal(issues.length, 0);
});

test('an implausible emissionFwhmNm is dropped and reported, but does not drop the whole entry', () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    fluorophores: {
      DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, emissionFwhmNm: -5 },
      FAM: { isFamily: true, variants: { 'fam red': { excitationPeakNm: 579, emissionPeakNm: 599, emissionFwhmNm: 'wide' } } },
    },
  });
  assert.ok(fluorophores.DYEA);
  assert.equal('emissionFwhmNm' in fluorophores.DYEA, false);
  assert.ok(fluorophores.FAM.variants['fam red']);
  assert.equal('emissionFwhmNm' in fluorophores.FAM.variants['fam red'], false);
  assert.ok(issues.some((i) => i.field === 'DYEA' && /implausible emissionFwhmNm/.test(i.message)));
  assert.ok(issues.some((i) => i.field === 'FAM' && /implausible emissionFwhmNm/.test(i.message)));
});

test("a family entry ('isFamily: true') requires a non-empty 'variants' object", () => {
  for (const variants of [undefined, {}, [], 'nope']) {
    const { fluorophores, issues } = loadSpectraKb({
      version: 1,
      fluorophores: { FAM: { isFamily: true, variants } },
    });
    assert.equal(fluorophores.FAM, undefined, String(variants));
    assert.ok(issues.some((i) => /'variants' must be a non-empty object/.test(i.message)));
  }
});

test('a family variant missing numeric peaks is dropped and reported, sibling variants survive', () => {
  const { fluorophores, issues } = loadSpectraKb({
    version: 1,
    fluorophores: {
      FAM: {
        isFamily: true,
        variants: {
          'fam red': { excitationPeakNm: 579, emissionPeakNm: 599 },
          'fam bad': { excitationPeakNm: 'nope' },
        },
      },
    },
  });
  assert.ok(fluorophores.FAM.variants['fam red']);
  assert.equal(fluorophores.FAM.variants['fam bad'], undefined);
  assert.ok(issues.some((i) => /variant 'fam bad' is missing numeric/.test(i.message)));
});

test('missing/non-numeric overlapRules thresholds default and are reported, never throw', () => {
  const { overlapRules, issues } = loadSpectraKb({ version: 1, fluorophores: {}, overlapRules: {} });
  assert.equal(overlapRules.emissionProximityNm, 25);
  assert.equal(overlapRules.excitationProximityNm, 20);
  assert.equal(overlapRules.schematicEmissionFwhmNm, 50);
  assert.equal(overlapRules.reviewStatus, 'claude-drafted');
  assert.ok(issues.some((i) => /emissionProximityNm is missing/.test(i.message)));
  assert.ok(issues.some((i) => /excitationProximityNm is missing/.test(i.message)));
});

test('schematic curve width is data-driven, backwards-compatible, and rejects implausible provided values', () => {
  const supplied = loadSpectraKb({
    version: 1,
    fluorophores: {},
    overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20, schematicEmissionFwhmNm: 72 },
  });
  assert.equal(supplied.overlapRules.schematicEmissionFwhmNm, 72);
  assert.deepEqual(supplied.issues, []);

  const absent = loadSpectraKb({
    version: 1,
    fluorophores: {},
    overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20 },
  });
  assert.equal(absent.overlapRules.schematicEmissionFwhmNm, 50);
  assert.deepEqual(absent.issues, []);

  for (const bad of [-1, 0, 301, Infinity, '50']) {
    const malformed = loadSpectraKb({
      version: 1,
      fluorophores: {},
      overlapRules: { emissionProximityNm: 25, excitationProximityNm: 20, schematicEmissionFwhmNm: bad },
    });
    assert.equal(malformed.overlapRules.schematicEmissionFwhmNm, 50, String(bad));
    assert.ok(malformed.issues.some((i) => /schematicEmissionFwhmNm/.test(i.message)), String(bad));
  }
});

// --- resolveMarkerToken: the five-state resolution --------------------------

test('SPECTRAL_STATES names exactly the five documented states', () => {
  assert.deepEqual(SPECTRAL_STATES, ['unrecognized', 'ambiguous-family', 'no-intrinsic-spectrum', 'spectrum-unavailable', 'known']);
});

test("an unknown token resolves 'unrecognized', canonical null", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const resolved = resolveMarkerToken('TOTALLY-MADE-UP', markerIndex, markersKb, fluorophores);
  assert.equal(resolved.state, 'unrecognized');
  assert.equal(resolved.canonical, null);
});

test("a tag/moiety class resolves 'no-intrinsic-spectrum' even with no spectra.json entry", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  assert.equal(resolveMarkerToken('TAGX', markerIndex, markersKb, fluorophores).state, 'no-intrinsic-spectrum');
  assert.equal(resolveMarkerToken('MOIETYX', markerIndex, markersKb, fluorophores).state, 'no-intrinsic-spectrum');
});

test("a real dye/protein canonical with no spectra.json entry resolves 'spectrum-unavailable'", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const resolved = resolveMarkerToken('DYEGAP', markerIndex, markersKb, fluorophores);
  assert.equal(resolved.state, 'spectrum-unavailable');
  assert.equal(resolved.canonical, 'DYEGAP');
});

test("a bare family name (no variant specified) resolves 'ambiguous-family'", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const resolved = resolveMarkerToken('FAMILYDYE', markerIndex, markersKb, fluorophores);
  assert.equal(resolved.state, 'ambiguous-family');
  assert.equal(resolved.canonical, 'FAMILYDYE');
});

test("a specific family variant resolves 'known' with that variant's peaks", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const resolved = resolveMarkerToken('FAMILYDYE RED', markerIndex, markersKb, fluorophores);
  assert.equal(resolved.state, 'known');
  assert.equal(resolved.excitationPeakNm, 579);
  assert.equal(resolved.emissionPeakNm, 599);
});

test("a plain (non-family) recognized dye with a spectra.json entry resolves 'known'", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const resolved = resolveMarkerToken('DYEA', markerIndex, markersKb, fluorophores);
  assert.equal(resolved.state, 'known');
  assert.equal(resolved.excitationPeakNm, 490);
  assert.equal(resolved.emissionPeakNm, 525);
  assert.equal(resolved.reviewStatus, 'claude-drafted');
});

test("resolveMarkerToken carries a resolved fluorophore's emissionFwhmNm through to the caller (plain and family-variant), absent when the pack has none", () => {
  const { markerIndex, markersKb } = fixtures();
  const { fluorophores } = loadSpectraKb({
    version: 1,
    fluorophores: {
      DYEA: { excitationPeakNm: 490, emissionPeakNm: 525, emissionFwhmNm: 40 },
      FAMILYDYE: {
        isFamily: true,
        variants: { 'familydye red': { excitationPeakNm: 579, emissionPeakNm: 599, emissionFwhmNm: 55 } },
      },
      HYDYE: { excitationPeakNm: 550, emissionPeakNm: 570 }, // no width authored -- must stay absent, not defaulted
    },
  });
  assert.equal(resolveMarkerToken('DYEA', markerIndex, markersKb, fluorophores).emissionFwhmNm, 40);
  assert.equal(resolveMarkerToken('FAMILYDYE RED', markerIndex, markersKb, fluorophores).emissionFwhmNm, 55);
  assert.equal(resolveMarkerToken('HYDYE', markerIndex, markersKb, fluorophores).emissionFwhmNm, undefined);
});

test('resolution is case/whitespace-insensitive on the token, matching splitMarkers uppercasing', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  assert.equal(resolveMarkerToken('  dyea  ', markerIndex, markersKb, fluorophores).state, 'known');
  assert.equal(resolveMarkerToken('DyeA', markerIndex, markersKb, fluorophores).state, 'known');
});

test('resolveMarkerToken never throws on malformed inputs', () => {
  assert.doesNotThrow(() => resolveMarkerToken('', undefined, undefined, undefined));
  assert.doesNotThrow(() => resolveMarkerToken(null, {}, {}, {}));
  assert.doesNotThrow(() => resolveMarkerToken('DYEA', { aliasToCanonical: undefined }, {}, {}));
});

test("a resolved family variant carries 'variantKey' (the matched variant), a non-family 'known' entry does not", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const familyResolved = resolveMarkerToken('FAMILYDYE RED', markerIndex, markersKb, fluorophores);
  assert.equal(familyResolved.variantKey, 'familydye red');
  const plainResolved = resolveMarkerToken('DYEA', markerIndex, markersKb, fluorophores);
  assert.equal(plainResolved.variantKey, undefined);
});

// --- resolvePanel: the whole-field resolution -------------------------------

test("an empty/whitespace-only markers field resolves panelState 'unanswered' with no entries", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  for (const text of ['', '   ', undefined, null]) {
    const { panelState, entries } = resolvePanel(text, markerIndex, markersKb, fluorophores);
    assert.equal(panelState, 'unanswered', String(text));
    assert.deepEqual(entries, []);
  }
});

test("a filled markers field resolves panelState 'has-entries', one per distinct canonical", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { panelState, entries } = resolvePanel('DyeA-DyeB', markerIndex, markersKb, fluorophores);
  assert.equal(panelState, 'has-entries');
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.canonical),
    ['DYEA', 'DYEB']
  );
});

test('a marker typed twice under different casing/spacing dedupes to one entry, keeping the first-seen spelling', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { entries } = resolvePanel('DyeA, dyea , DYEA', markerIndex, markersKb, fluorophores);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].token, 'DYEA'); // splitMarkers uppercases every token before this ever sees it
});

test('unrecognized tokens dedupe by their own text (no canonical to key on) instead of collapsing into one', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { entries } = resolvePanel('NOPE1-NOPE2-NOPE1', markerIndex, markersKb, fluorophores);
  assert.deepEqual(
    entries.map((e) => e.token),
    ['NOPE1', 'NOPE2']
  );
});

test('two different colors of the same family both survive as distinct entries, not collapsed by shared canonical', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { entries } = resolvePanel('FamilyDye Red, FamilyDye Green', markerIndex, markersKb, fluorophores);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.variantKey),
    ['familydye red', 'familydye green']
  );
  assert.ok(entries.every((e) => e.canonical === 'FAMILYDYE' && e.state === 'known'));
});

test('a marker typed twice as the SAME family variant still dedupes to one entry', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { entries } = resolvePanel('FamilyDye Red, familydye red', markerIndex, markersKb, fluorophores);
  assert.equal(entries.length, 1);
});

test('a hyphenated alias unreachable by a single splitMarkers token is recovered by the rejoin pass', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { entries } = resolvePanel('Hy-Dye', markerIndex, markersKb, fluorophores);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, 'known');
  assert.equal(entries[0].canonical, 'HYDYE');
});

test('the hyphen rejoin pass does not falsely glue two unrelated markers together', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { entries } = resolvePanel('DyeA-DyeB', markerIndex, markersKb, fluorophores);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.canonical),
    ['DYEA', 'DYEB']
  );
});

test("the app's own no-markers sentinels ('NONE', 'N/A', 'unstained', ...) resolve panelState 'no-markers-declared', not per-token 'unrecognized'", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  for (const text of ['NONE', 'none', ' NONE ', 'N/A', 'n/a', 'unstained', 'label-free', 'Unknown', 'TBD']) {
    const { panelState, entries } = resolvePanel(text, markerIndex, markersKb, fluorophores);
    assert.equal(panelState, 'no-markers-declared', String(text));
    assert.deepEqual(entries, []);
  }
});

test('a sentinel word embedded in longer prose is NOT treated as a no-markers declaration', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const { panelState } = resolvePanel('none yet, TBD pending panel design', markerIndex, markersKb, fluorophores);
  assert.equal(panelState, 'has-entries');
});

// --- flagPanelOverlaps: the pairwise qualitative check ----------------------

function known(token, canonical, excitationPeakNm, emissionPeakNm) {
  return { token, canonical, state: 'known', excitationPeakNm, emissionPeakNm, reviewStatus: 'claude-drafted' };
}

test('two entries 10 nm apart in emission (under the 25 nm default) flag severity error', () => {
  const entries = [known('A', 'A', 400, 500), known('B', 'B', 460, 510)];
  const flags = flagPanelOverlaps(entries, { emissionProximityNm: 25, excitationProximityNm: 20 });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, 'error');
  assert.match(flags[0].message, /emission peaks 10 nm apart/);
});

test('two entries 15 nm apart in excitation only (emission far apart) flag severity warning, not error', () => {
  const entries = [known('A', 'A', 400, 500), known('B', 'B', 415, 600)];
  const flags = flagPanelOverlaps(entries, { emissionProximityNm: 25, excitationProximityNm: 20 });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, 'warning');
  assert.match(flags[0].message, /excitation peaks 15 nm apart/);
});

test('entries outside both thresholds produce zero flags', () => {
  const entries = [known('A', 'A', 400, 500), known('B', 'B', 500, 600)];
  const flags = flagPanelOverlaps(entries, { emissionProximityNm: 25, excitationProximityNm: 20 });
  assert.deepEqual(flags, []);
});

test('non-known entries (unrecognized/ambiguous/etc.) never participate in the pairwise scan', () => {
  const entries = [
    known('A', 'A', 400, 500),
    { token: 'B', canonical: null, state: 'unrecognized' },
    { token: 'C', canonical: 'C', state: 'spectrum-unavailable' },
  ];
  const flags = flagPanelOverlaps(entries, { emissionProximityNm: 25, excitationProximityNm: 20 });
  assert.deepEqual(flags, []);
});

test('three-way overlap orders flags severity-first, then by ascending gap, deterministically across repeated calls', () => {
  const entries = [known('A', 'A', 400, 500), known('B', 'B', 405, 505), known('C', 'C', 460, 515)];
  const first = flagPanelOverlaps(entries, { emissionProximityNm: 25, excitationProximityNm: 20 });
  const second = flagPanelOverlaps(entries.slice().reverse(), { emissionProximityNm: 25, excitationProximityNm: 20 });
  // A-B: em gap 5 (error), ex gap 5 (warning); A-C/B-C: em gap 15/10 (error), ex gap 60/55 (not flagged).
  assert.equal(first.length, 4);
  assert.deepEqual(first, second); // input order must not affect the result
  // Severity first (every error ahead of every warning), then ascending gap
  // within a severity: A-B em(5, error), B-C em(10, error), A-C em(15, error),
  // A-B ex(5, warning) -- the ONE warning sorts last despite its small gap.
  assert.deepEqual(
    first.map((f) => f.severity),
    ['error', 'error', 'error', 'warning']
  );
  assert.match(first[0].message, /A and B/);
  assert.match(first[1].message, /B and C/);
  assert.match(first[2].message, /A and C/);
  assert.match(first[3].message, /A and B/);
});

test('flagPanelOverlaps never throws on an empty or malformed overlapRules', () => {
  assert.doesNotThrow(() => flagPanelOverlaps([], undefined));
  assert.doesNotThrow(() => flagPanelOverlaps([known('A', 'A', 400, 500)], {}));
});

// --- derivePanelFacts: the panel-level facts engine/controls.js gates on ---
// (fixes a real, verified defect: every 'panel'-kind control rule shared
// ONE predicate, so an isotype/secondary-antibody control fired on panels
// that never used an antibody at all -- see this function's own header.)

test("an empty or 'no markers declared' field derives an all-false/zero shape, never a throw", () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  for (const text of ['', '   ', 'NONE', 'n/a', 'unstained']) {
    const facts = derivePanelFacts(text, markerIndex, markersKb, fluorophores);
    assert.deepEqual(facts, { fluorophoreCount: 0, hasAntibody: false, hasTag: false, classes: [], hasMarkersDeclared: false }, text);
  }
});

test('fluorophoreCount counts every resolved, non-typo entry -- a tag/moiety/gap still counts as a real channel', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  // DYEA (known), TAGX (no-intrinsic-spectrum), DYEGAP (spectrum-unavailable),
  // BOGUS (unrecognized -- excluded).
  const facts = derivePanelFacts('DyeA, TagX, DyeGap, Bogus', markerIndex, markersKb, fluorophores);
  assert.equal(facts.fluorophoreCount, 3);
  assert.equal(facts.hasMarkersDeclared, true);
});

test('hasAntibody is true only when a resolved marker is class "target", not merely "moiety"', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const withTarget = derivePanelFacts('DyeA, TargetX', markerIndex, markersKb, fluorophores);
  assert.equal(withTarget.hasAntibody, true);

  const withMoietyOnly = derivePanelFacts('DyeA, MoietyX', markerIndex, markersKb, fluorophores);
  assert.equal(withMoietyOnly.hasAntibody, false, 'a direct-conjugate moiety (no antibody) must not set hasAntibody');
});

test('hasTag is true only when a resolved marker is class "tag"', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  assert.equal(derivePanelFacts('TagX', markerIndex, markersKb, fluorophores).hasTag, true);
  assert.equal(derivePanelFacts('DyeA', markerIndex, markersKb, fluorophores).hasTag, false);
});

test('classes lists every distinct resolved class, sorted, deduplicated', () => {
  const { markerIndex, markersKb, fluorophores } = fixtures();
  const facts = derivePanelFacts('DyeA, DyeB, TagX', markerIndex, markersKb, fluorophores);
  assert.deepEqual(facts.classes, ['dye', 'tag']);
});

test('derivePanelFacts never throws on malformed inputs', () => {
  assert.doesNotThrow(() => derivePanelFacts(undefined, undefined, undefined, undefined));
  assert.doesNotThrow(() => derivePanelFacts(null, {}, {}, {}));
});

// ============================================================================
// Committed-content guards for the REAL web/kb/spectra.json (PAN-3), mirroring
// advisor.test.js/controls.test.js's split between synthetic-fixture tests
// (above) and real-content guards (below).
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const realSpectraRaw = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'spectra.json'), 'utf-8'));
const realMarkersRaw = JSON.parse(readFileSync(path.join(here, '..', 'kb', 'markers.json'), 'utf-8'));
const sourceLedgerRaw = JSON.parse(
  readFileSync(
    path.join(here, '..', '..', 'docs', 'references', 'planner-fluorophore-sources.json'),
    'utf-8'
  )
);

const SOURCE_VARIANT_KEYS = {
  LYSOTRACKERBLUE: 'lysotracker blue',
  LYSOTRACKERYELLOW: 'lysotracker yellow',
  LYSOTRACKERDEEPRED: 'lysotracker deep red',
  LIVEDEADAQUA: 'livedead aqua',
  LIVEDEADYELLOW: 'livedead yellow',
  LIVEDEADNEARIR: 'livedead near ir',
  SYTO40: 'syto 40',
  SYTO41: 'syto 41',
  SYTO42: 'syto 42',
  SYTO45: 'syto 45',
  SYTORNASELECT: 'syto rnaselect',
};

// The canonicals deliberately excluded from spectra.json as honest content
// gaps (docs/plans/planner-web-color-panel.md), updated by the alpha-
// readiness content pass: BODIPY/CELLMASK/ERTRACKER were promoted to real
// families with named variants (no longer gaps), and SOX/SOX2 were
// reclassified 'moiety' (they are antibody targets, not dyes -- covered by
// the tag/moiety branch below, not this list) rather than staying dyes with
// no spectrum. What remains genuinely uncovered:
//   - RFP: heterogeneous, "RFP" is not one protein.
//   - FURA2: ratiometric (two excitation peaks by Ca2+ state) -- does not
//     fit this app's single-peak model at all.
//   - ARL: identity is not confidently known -- drafting a peak for an
//     unidentified marker would be actively misleading, not merely
//     incomplete.
// Named explicitly so an accidental future omission (rather than a
// deliberate one) fails this guard loudly.
const DELIBERATELY_UNCOVERED = new Set(['RFP', 'FURA2', 'ARL', 'HALO', 'SNAP', 'CLIP', 'PHALLOIDIN', 'WGA']);

test('the real web/kb/spectra.json loads with zero issues', () => {
  const { issues } = loadSpectraKb(realSpectraRaw);
  assert.deepEqual(issues, []);
});

test('all 72 direct and 11 family additions exactly match the source ledger and runtime whitelist', () => {
  assert.equal(sourceLedgerRaw.directRecords.length, 72);
  assert.equal(sourceLedgerRaw.familyVariantRecords.length, 11);
  const directFields = new Set([
    'excitationPeakNm',
    'emissionPeakNm',
    // emissionFwhmNm (color-panel curve-shape patch) is a claude-drafted
    // CLASS-based estimate, not a vendor-sourced peak -- it deliberately has
    // no ledger row of its own and isn't value-checked below, only allowed
    // to be present without failing this "no undocumented field" guard.
    'emissionFwhmNm',
    'reviewStatus',
    'note',
  ]);

  for (const row of sourceLedgerRaw.directRecords) {
    const entry = realSpectraRaw.fluorophores[row.id];
    assert.ok(entry && entry.isFamily !== true, `${row.id}: missing direct spectrum`);
    assert.deepEqual(
      Object.keys(entry).filter((key) => !directFields.has(key)),
      [],
      `${row.id}: unrecognized runtime field`
    );
    assert.equal(entry.excitationPeakNm, row.excitationPeakNm, `${row.id}: excitation`);
    assert.equal(entry.emissionPeakNm, row.emissionPeakNm, `${row.id}: emission`);
    assert.equal(entry.note, row.measurementContext, `${row.id}: condition note`);
    // Every direct record's numeric peaks (and note) match this ledger row
    // exactly (checked above), so its reviewStatus has been upgraded from
    // the default 'claude-drafted' to 'source-cited' -- see
    // docs/references/planner-fluorophore-sources.json's sourceUrl/
    // retrievalDate for the citation. Family records (below) stay
    // 'claude-drafted': reviewStatus lives on the whole family entry, and
    // these families have sibling variants the ledger does not cover, so
    // upgrading the family-level status would falsely certify those too.
    assert.equal(entry.reviewStatus, 'source-cited', `${row.id}: review status`);
    assert.ok(realMarkersRaw.markers[row.id], `${row.id}: missing marker canonical`);
    assert.ok(
      300 <= entry.excitationPeakNm &&
        entry.excitationPeakNm < entry.emissionPeakNm &&
        entry.emissionPeakNm <= 900,
      `${row.id}: implausible peak pair`
    );
  }

  for (const row of sourceLedgerRaw.familyVariantRecords) {
    const variantKey = SOURCE_VARIANT_KEYS[row.id];
    assert.ok(variantKey, `${row.id}: missing runtime variant-key mapping`);
    const familyEntry = realSpectraRaw.fluorophores[row.family];
    const variant = familyEntry?.variants?.[variantKey];
    assert.ok(variant, `${row.id}: missing '${row.family}' variant '${variantKey}'`);
    // Peak-only plus the same claude-drafted emissionFwhmNm every direct
    // record may carry (see directFields above) -- not ledger-verified,
    // just allowed.
    assert.deepEqual(
      Object.keys(variant).sort(),
      ['emissionFwhmNm', 'emissionPeakNm', 'excitationPeakNm'],
      `${row.id}: family variants stay peak(+width)-only`
    );
    assert.equal(variant.excitationPeakNm, row.excitationPeakNm, `${row.id}: excitation`);
    assert.equal(variant.emissionPeakNm, row.emissionPeakNm, `${row.id}: emission`);
    assert.equal(familyEntry.reviewStatus, 'claude-drafted', `${row.family}: review status`);
    assert.ok(
      realMarkersRaw.markers[row.family].variants.includes(variantKey),
      `${row.id}: variant missing from markers.json`
    );
  }
});

test('every top-level web/kb/spectra.json fluorophore key exists as a canonical in web/kb/markers.json', () => {
  for (const canonical of Object.keys(realSpectraRaw.fluorophores)) {
    assert.ok(canonical in realMarkersRaw.markers, `'${canonical}' has no markers.json entry`);
  }
});

test("every family entry's variant keys are a subset of that canonical's markers.json 'variants' list", () => {
  for (const [canonical, entry] of Object.entries(realSpectraRaw.fluorophores)) {
    if (!entry.isFamily) continue;
    const markerVariants = new Set(realMarkersRaw.markers[canonical].variants);
    for (const variantKey of Object.keys(entry.variants)) {
      assert.ok(markerVariants.has(variantKey), `'${canonical}' variant '${variantKey}' is not in markers.json's variants list`);
    }
  }
});

test('every markers.json canonical is accounted for: a real spectrum, a tag/moiety class, or a named deliberate gap', () => {
  const { fluorophores } = loadSpectraKb(realSpectraRaw);
  for (const [canonical, entry] of Object.entries(realMarkersRaw.markers)) {
    const hasSpectrum = canonical in fluorophores;
    const isNoIntrinsicSpectrumClass = entry.class === 'tag' || entry.class === 'moiety' || entry.class === 'target';
    const isDeliberateGap = DELIBERATELY_UNCOVERED.has(canonical);
    assert.ok(
      hasSpectrum || isNoIntrinsicSpectrumClass || isDeliberateGap,
      `'${canonical}' is neither in spectra.json, a tag/moiety, nor a named deliberate gap -- an unaccounted-for omission`
    );
    // A canonical cannot be BOTH a real spectrum entry AND a named gap --
    // that would mean DELIBERATELY_UNCOVERED is stale relative to spectra.json.
    if (hasSpectrum) assert.ok(!isDeliberateGap, `'${canonical}' has a real spectrum AND is listed as a deliberate gap -- stale list`);
  }
});

test('resolveMarkerToken against the REAL packs: a known dye, a family variant, a bare family name, and a tag all resolve as designed', () => {
  const { kb: markersKb } = loadKb(realMarkersRaw);
  const markerIndex = indexKb(markersKb);
  const { fluorophores } = loadSpectraKb(realSpectraRaw);

  assert.equal(resolveMarkerToken('ALEXA488', markerIndex, markersKb, fluorophores).state, 'known');
  assert.equal(resolveMarkerToken('MITOTRACKER RED', markerIndex, markersKb, fluorophores).state, 'known');
  assert.equal(resolveMarkerToken('MITOTRACKER', markerIndex, markersKb, fluorophores).state, 'ambiguous-family');
  assert.equal(resolveMarkerToken('HALO', markerIndex, markersKb, fluorophores).state, 'no-intrinsic-spectrum');
  assert.equal(resolveMarkerToken('BODIPY', markerIndex, markersKb, fluorophores).state, 'ambiguous-family');
  assert.equal(resolveMarkerToken('FURA2', markerIndex, markersKb, fluorophores).state, 'spectrum-unavailable');
  assert.equal(resolveMarkerToken('BODIPY FL', markerIndex, markersKb, fluorophores).state, 'known');
  assert.equal(resolveMarkerToken('SOX2', markerIndex, markersKb, fluorophores).state, 'no-intrinsic-spectrum');
});

test('the real resolver covers every new category plus unchanged ambiguity/gap/no-intrinsic states', () => {
  const { kb: markersKb } = loadKb(realMarkersRaw);
  const markerIndex = indexKb(markersKb);
  const { fluorophores } = loadSpectraKb(realSpectraRaw);
  const cases = [
    ['Alexa Fluor 790', 'ALEXA790', 'known'],
    ['mScarlet-I', 'MSCARLETI', 'known'],
    ['LipidTOX Deep Red', 'LIPIDTOXDEEPRED', 'known'],
    ['CellROX Deep Red', 'CELLROXDEEPRED', 'known'],
    ['IRDye 800CW', 'IRDYE800CW', 'known'],
    ['LysoTracker Deep Red', 'LYSOTRACKER', 'known', 'lysotracker deep red'],
    ['LIVEDEAD Near IR', 'LIVEDEAD', 'known', 'livedead near ir'],
    ['LIVE-DEAD Near IR', 'LIVEDEAD', 'known', 'livedead near ir'],
    ['SYTO RNASelect', 'SYTO', 'known', 'syto rnaselect'],
    ['LYSOTRACKER', 'LYSOTRACKER', 'ambiguous-family'],
    ['FURA2', 'FURA2', 'spectrum-unavailable'],
    ['HALO', 'HALO', 'no-intrinsic-spectrum'],
  ];
  for (const [token, canonical, state, variantKey] of cases) {
    const resolved = resolveMarkerToken(token, markerIndex, markersKb, fluorophores);
    assert.equal(resolved.canonical, canonical, token);
    assert.equal(resolved.state, state, token);
    assert.equal(resolved.variantKey, variantKey, token);
  }
});

test('ledger-backed pairs respect the real overlap thresholds for error, warning, and separation', () => {
  const { kb: markersKb } = loadKb(realMarkersRaw);
  const markerIndex = indexKb(markersKb);
  const { fluorophores, overlapRules } = loadSpectraKb(realSpectraRaw);
  const resolve = (token) => resolveMarkerToken(token, markerIndex, markersKb, fluorophores);

  const emissionPair = [resolve('mScarlet-I'), resolve('mScarlet3')];
  const emissionGap = Math.abs(emissionPair[0].emissionPeakNm - emissionPair[1].emissionPeakNm);
  assert.ok(emissionGap <= overlapRules.emissionProximityNm);
  const emissionFlags = flagPanelOverlaps(emissionPair, overlapRules);
  assert.ok(emissionFlags.some((flag) => flag.severity === 'error' && /emission peaks/.test(flag.message)));

  const excitationPair = [resolve('Pacific Orange'), resolve('DyLight 405')];
  const excitationGap = Math.abs(
    excitationPair[0].excitationPeakNm - excitationPair[1].excitationPeakNm
  );
  const distantEmissionGap = Math.abs(
    excitationPair[0].emissionPeakNm - excitationPair[1].emissionPeakNm
  );
  assert.ok(excitationGap <= overlapRules.excitationProximityNm);
  assert.ok(distantEmissionGap > overlapRules.emissionProximityNm);
  const excitationFlags = flagPanelOverlaps(excitationPair, overlapRules);
  assert.deepEqual(excitationFlags.map((flag) => flag.severity), ['warning']);

  const separatedFlags = flagPanelOverlaps(
    [resolve('Alexa Fluor 790'), resolve('CF 350')],
    overlapRules
  );
  assert.deepEqual(separatedFlags, []);
});
