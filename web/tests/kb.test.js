import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadKb, indexKb, kbMarker } from '../src/core/kb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const markersJsonPath = path.join(here, '..', 'kb', 'markers.json');
const sourceLedgerPath = path.join(
  here,
  '..',
  '..',
  'docs',
  'references',
  'planner-fluorophore-sources.json'
);
const realRaw = JSON.parse(readFileSync(markersJsonPath, 'utf-8'));
const sourceLedger = JSON.parse(readFileSync(sourceLedgerPath, 'utf-8'));

function minimalRaw(overrides = {}) {
  return {
    version: 1,
    markers: {
      ALEXA488: {
        aliases: ['af488', 'alexa 488', 'alexa fluor 488', 'alexa488'],
        freeTextAliases: ['af488', 'alexa 488', 'alexa fluor 488', 'alexa488'],
        class: 'dye',
        isFamily: false,
        variants: [],
      },
      VENUS: {
        aliases: ['venus'],
        freeTextAliases: [],
        class: 'protein',
        isFamily: false,
        variants: [],
      },
    },
    ambiguousInFreeText: ['venus'],
    ...overrides,
  };
}

// --- loadKb: totality -------------------------------------------------------

test('loadKb never throws on wildly malformed input', () => {
  for (const bad of [null, undefined, 42, 'nope', [], [1, 2, 3], true]) {
    assert.doesNotThrow(() => loadKb(bad));
    const { kb, issues } = loadKb(bad);
    assert.ok(kb && typeof kb === 'object');
    assert.deepEqual(kb.markers, {});
    assert.ok(issues.some((i) => i.severity === 'fatal'));
  }
});

test('loadKb reports a fatal issue for a missing version and does not throw', () => {
  const raw = minimalRaw();
  delete raw.version;
  let result;
  assert.doesNotThrow(() => {
    result = loadKb(raw);
  });
  assert.ok(result.issues.some((i) => i.severity === 'fatal'));
  // The KB must still be a safely-indexable object even when fatally flagged.
  assert.ok(result.kb.markers && typeof result.kb.markers === 'object');
});

test('loadKb reports a fatal issue for a wrong version and does not throw', () => {
  const raw = minimalRaw({ version: 2 });
  let result;
  assert.doesNotThrow(() => {
    result = loadKb(raw);
  });
  assert.ok(result.issues.some((i) => i.severity === 'fatal'));
  assert.ok(result.issues.some((i) => i.message.includes('2')));
});

test('loadKb accepts a well-formed KB with zero issues', () => {
  const { kb, issues } = loadKb(minimalRaw());
  assert.deepEqual(issues, []);
  assert.equal(kb.version, 1);
  assert.ok('ALEXA488' in kb.markers);
  assert.ok('VENUS' in kb.markers);
});

test('loadKb reports a marker entry missing aliases BY NAME and drops it, without throwing', () => {
  const raw = minimalRaw();
  delete raw.markers.ALEXA488.aliases;
  let result;
  assert.doesNotThrow(() => {
    result = loadKb(raw);
  });
  const { kb, issues } = result;
  const hit = issues.find((i) => i.severity === 'error' && i.message.includes('ALEXA488'));
  assert.ok(hit, `expected an issue naming ALEXA488, got: ${JSON.stringify(issues)}`);
  assert.ok(hit.message.includes('aliases'));
  // The malformed entry itself must not survive into the usable kb.
  assert.ok(!('ALEXA488' in kb.markers));
  // Unrelated, well-formed entries must be unaffected.
  assert.ok('VENUS' in kb.markers);
});

test('loadKb reports a non-object marker entry BY NAME without throwing', () => {
  const raw = minimalRaw();
  raw.markers.BROKEN = 'not an object';
  let result;
  assert.doesNotThrow(() => {
    result = loadKb(raw);
  });
  assert.ok(result.issues.some((i) => i.severity === 'error' && i.message.includes('BROKEN')));
  assert.ok(!('BROKEN' in result.kb.markers));
});

test('loadKb tolerates a non-object markers field and a non-array ambiguousInFreeText', () => {
  const raw = minimalRaw({ markers: 'nope', ambiguousInFreeText: 'nope' });
  let result;
  assert.doesNotThrow(() => {
    result = loadKb(raw);
  });
  assert.deepEqual(result.kb.markers, {});
  assert.deepEqual(result.kb.ambiguousInFreeText, []);
});

// --- indexKb -----------------------------------------------------------------

test('indexKb maps a known alias to its canonical case-insensitively', () => {
  const { kb } = loadKb(minimalRaw());
  const { aliasToCanonical } = indexKb(kb);
  assert.equal(aliasToCanonical.get('af488'), 'ALEXA488');
  assert.equal(aliasToCanonical.get('AF488'.toLowerCase()), 'ALEXA488');
});

test('indexKb: every ambiguousInFreeText entry is absent from freeTextAliasToCanonical while still present in aliasToCanonical', () => {
  const { kb } = loadKb(realRaw);
  const { aliasToCanonical, freeTextAliasToCanonical } = indexKb(kb);
  assert.ok(kb.ambiguousInFreeText.length > 0, 'fixture must actually exercise the exclusion');
  for (const ambiguous of kb.ambiguousInFreeText) {
    assert.ok(
      aliasToCanonical.has(ambiguous),
      `expected '${ambiguous}' to still resolve via aliasToCanonical`
    );
    assert.ok(
      !freeTextAliasToCanonical.has(ambiguous),
      `expected '${ambiguous}' to be EXCLUDED from freeTextAliasToCanonical`
    );
  }
});

test('indexKb never throws on an empty/malformed kb and yields empty maps', () => {
  assert.doesNotThrow(() => indexKb(null));
  assert.doesNotThrow(() => indexKb(undefined));
  assert.doesNotThrow(() => indexKb({}));
  const { aliasToCanonical, freeTextAliasToCanonical, canonicals } = indexKb(null);
  assert.equal(aliasToCanonical.size, 0);
  assert.equal(freeTextAliasToCanonical.size, 0);
  assert.deepEqual(canonicals, []);
});

test('indexKb canonicals lists every marker in the KB', () => {
  const { kb } = loadKb(minimalRaw());
  const { canonicals } = indexKb(kb);
  assert.deepEqual(canonicals.slice().sort(), ['ALEXA488', 'VENUS']);
});

// --- kbMarker ------------------------------------------------------------

test('kbMarker returns the entry for a known canonical and undefined for an unknown one', () => {
  const { kb } = loadKb(minimalRaw());
  assert.equal(kbMarker(kb, 'ALEXA488').class, 'dye');
  assert.equal(kbMarker(kb, 'NOPE'), undefined);
});

test('kbMarker never throws on a malformed kb', () => {
  assert.doesNotThrow(() => kbMarker(null, 'ALEXA488'));
  assert.equal(kbMarker(null, 'ALEXA488'), undefined);
  assert.equal(kbMarker(42, 'ALEXA488'), undefined);
});

// --- The real, committed web/kb/markers.json --------------------------------

test('the committed web/kb/markers.json loads with zero issues', () => {
  const { kb, issues } = loadKb(realRaw);
  assert.deepEqual(issues, []);
  assert.equal(kb.version, 1);
  assert.ok(Object.keys(kb.markers).length > 0);
});

test('the real KB resolves af488 -> ALEXA488 and excludes real ambiguous aliases from free text', () => {
  const { kb } = loadKb(realRaw);
  const { aliasToCanonical, freeTextAliasToCanonical } = indexKb(kb);
  assert.equal(aliasToCanonical.get('af488'), 'ALEXA488');
  for (const alias of ['snap', 'halo', 'clip', 'venus', 'citrine', 'emerald', 'cerulean', 'tomato']) {
    assert.ok(aliasToCanonical.has(alias), `'${alias}' should still be a valid exact-lookup alias`);
    assert.ok(
      !freeTextAliasToCanonical.has(alias),
      `'${alias}' must be excluded from free-text scanning`
    );
  }
});

test('the real KB marks family markers with isFamily and non-empty variants where applicable', () => {
  const { kb } = loadKb(realRaw);
  assert.equal(kbMarker(kb, 'MITOTRACKER').isFamily, true);
  assert.ok(kbMarker(kb, 'MITOTRACKER').variants.length > 0);
  assert.equal(kbMarker(kb, 'GCAMP').isFamily, true);
  assert.equal(kbMarker(kb, 'GCAMP').class, 'indicator');
  assert.equal(kbMarker(kb, 'HALO').class, 'tag');
  assert.equal(kbMarker(kb, 'PHALLOIDIN').class, 'moiety');
  assert.equal(kbMarker(kb, 'GFP').class, 'protein');
});

test('all 136 source-approved canonicals exist once with their editorial classes', () => {
  const { kb, issues } = loadKb(realRaw);
  assert.deepEqual(issues, []);
  assert.equal(sourceLedger.directRecords.length, 136);

  const classForCategory = {
    'organic/NIR': 'dye',
    'fluorescent protein': 'protein',
    'live-cell/organelle': 'stain',
    'nucleic-acid stain': 'stain',
    indicator: 'indicator',
  };
  const expected = new Set();
  for (const row of sourceLedger.directRecords) {
    assert.ok(!expected.has(row.id), `duplicate source-ledger canonical '${row.id}'`);
    expected.add(row.id);
    const entry = kbMarker(kb, row.id);
    assert.ok(entry, `missing source-approved canonical '${row.id}'`);
    assert.equal(entry.class, classForCategory[row.category], `${row.id} class`);
    assert.equal(entry.isFamily, false, `${row.id} must be a direct canonical`);
  }
  assert.equal(expected.size, 136);
});

test('the normalized real alias index has one owner per spelling and resolves representative additions', () => {
  const { kb, issues } = loadKb(realRaw);
  assert.deepEqual(issues, []);
  const { aliasToCanonical, freeTextAliasToCanonical } = indexKb(kb);

  // indexKb owns lowercasing. Checking every producer alias against its
  // indexed owner catches a later duplicate alias silently overwriting the
  // earlier canonical in the Map.
  for (const [canonical, entry] of Object.entries(kb.markers)) {
    for (const alias of entry.aliases) {
      assert.equal(aliasToCanonical.get(alias.toLowerCase()), canonical, `alias '${alias}'`);
    }
    for (const alias of entry.freeTextAliases) {
      assert.equal(
        freeTextAliasToCanonical.get(alias.toLowerCase()),
        canonical,
        `free-text alias '${alias}'`
      );
    }
  }

  const representativeAliases = {
    'Alexa Fluor 790': 'ALEXA790',
    'CF 405S': 'CF405S',
    'mScarlet-I': 'MSCARLETI',
    sfGFP: 'SUPERFOLDERGFP',
    '7-AAD': '7AAD',
    'IRDye 800CW': 'IRDYE800CW',
    'LysoTracker Deep Red': 'LYSOTRACKER',
    'LIVEDEAD Near IR': 'LIVEDEAD',
    'LIVE-DEAD Near IR': 'LIVEDEAD',
    'SYTO RNASelect': 'SYTO',
  };
  for (const [alias, canonical] of Object.entries(representativeAliases)) {
    assert.equal(aliasToCanonical.get(alias.toLowerCase()), canonical, alias);
  }

  // DiR's short exact spelling is useful in structured metadata but is a
  // directory-command false positive in prose, so it must never leak into
  // the free-text index.
  assert.equal(aliasToCanonical.get('dir'), 'DIR');
  assert.equal(freeTextAliasToCanonical.has('dir'), false);
});

test('LYSOTRACKER, LIVEDEAD, and SYTO expose exactly the old plus 11 approved variants', () => {
  const { kb } = loadKb(realRaw);
  assert.deepEqual(kbMarker(kb, 'LYSOTRACKER').variants, [
    'lysotracker blue',
    'lysotracker deep red',
    'lysotracker green',
    'lysotracker red',
    'lysotracker yellow',
  ]);
  assert.deepEqual(kbMarker(kb, 'LIVEDEAD').variants, [
    'livedead aqua',
    'livedead blue',
    'livedead far red',
    'livedead green',
    'livedead near ir',
    'livedead red',
    'livedead violet',
    'livedead yellow',
  ]);
  assert.deepEqual(kbMarker(kb, 'SYTO').variants, [
    'syto 40',
    'syto 41',
    'syto 42',
    'syto 45',
    'syto rnaselect',
    'syto13',
    'syto60',
    'syto82',
    'syto85',
    'syto9',
  ]);
});
