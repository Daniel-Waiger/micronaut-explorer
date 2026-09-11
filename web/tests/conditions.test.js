// Tests for the condition matrix engine: groups x factors x replicates ->
// condition rows -> group labels. Row order is a CONTRACT (see the module
// header in conditions.js), so the primary test pins the exact sequence with
// a full deepEqual against a literal expected array.
//
// The central thing under test throughout this file: design.groups (the GROUP
// axis) is SINGULAR and must never self-cross, even though it DOES cross with
// genuine factors[] axes. That distinction is what fixes the 'CT-NAM50MM'
// defect (a sample that was somehow both the control and the 50 mM group,
// because groups were modeled as two factors and crossed against each other).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_SEGMENT_SEPARATOR,
  SAMPLE_ID_SAFE_CHAR_PATTERN,
  buildGroupLabel,
  buildGroupSegments,
  buildSampleId,
  conditionIssues,
  expandConditions,
  formatReplicateToken,
  physicalSampleCount,
} from '../src/engine/conditions.js';
import { sanitizeToken } from '../src/engine/naming.js';

test('expandConditions pins the exact row sequence: group outermost, then factors, then bioRep, then techRep innermost', () => {
  const design = {
    groups: { levels: ['CT', 'NAM50MM'] },
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    biologicalReplicates: 2,
    technicalReplicates: null,
  };

  // 2 group levels x 2 genotype levels x 2 bio replicates x (tech omitted) = 8.
  const expected = [
    { id: 0, group: 'CT', factorLevels: { genotype: 'WT' }, bioRep: 1, techRep: null },
    { id: 1, group: 'CT', factorLevels: { genotype: 'WT' }, bioRep: 2, techRep: null },
    { id: 2, group: 'CT', factorLevels: { genotype: 'KO' }, bioRep: 1, techRep: null },
    { id: 3, group: 'CT', factorLevels: { genotype: 'KO' }, bioRep: 2, techRep: null },
    { id: 4, group: 'NAM50MM', factorLevels: { genotype: 'WT' }, bioRep: 1, techRep: null },
    { id: 5, group: 'NAM50MM', factorLevels: { genotype: 'WT' }, bioRep: 2, techRep: null },
    { id: 6, group: 'NAM50MM', factorLevels: { genotype: 'KO' }, bioRep: 1, techRep: null },
    { id: 7, group: 'NAM50MM', factorLevels: { genotype: 'KO' }, bioRep: 2, techRep: null },
  ];

  assert.deepEqual(expandConditions(design), expected);
});

test('the group axis never self-crosses -- CT and NAM50MM never appear on the same row (the CT-NAM50MM regression)', () => {
  const design = { groups: { levels: ['CT', 'NAM25MM', 'NAM50MM'] }, factors: [] };
  const rows = expandConditions(design);

  assert.equal(rows.length, 3, `expected exactly 3 rows (one per group), got ${rows.length}`);
  // Each row carries exactly ONE group value -- there is no way to construct a
  // row carrying more than one, because `group` is a single field, not an array.
  for (const row of rows) {
    assert.ok(typeof row.group === 'string', `row.group should be a single string, got ${JSON.stringify(row.group)}`);
  }
  assert.deepEqual(rows.map((r) => r.group).sort(), ['CT', 'NAM25MM', 'NAM50MM']);
});

test('the group axis DOES cross with genuine factors (WT/KO x CT/drug is a legitimate 2x2)', () => {
  const design = {
    groups: { levels: ['CT', 'drug'] },
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
  };
  const rows = expandConditions(design);
  assert.equal(rows.length, 4);
  const combos = rows.map((r) => `${r.group}:${r.factorLevels.genotype}`).sort();
  assert.deepEqual(combos, ['CT:KO', 'CT:WT', 'drug:KO', 'drug:WT']);
});

test('no group levels defined is legal and omits the axis (group: null on every row)', () => {
  const design = { groups: { levels: [] }, factors: [{ name: 'genotype', levels: ['WT', 'KO'] }] };
  const rows = expandConditions(design);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.group === null));
  assert.deepEqual(conditionIssues(design), []);
});

test('zero factors and no groups is legal and yields exactly one unconditioned row', () => {
  const design = { groups: { levels: [] }, factors: [] };
  assert.deepEqual(expandConditions(design), [
    { id: 0, group: null, factorLevels: {}, bioRep: null, techRep: null },
  ]);
  assert.deepEqual(conditionIssues(design), []);
});

test('a factor with zero levels yields zero rows AND an issue', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT', 'KO'] },
      { name: 'treatment', levels: [] },
    ],
  };

  assert.deepEqual(expandConditions(design), []);

  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'factors' && i.severity === 'error' && i.message.includes('treatment')
    ),
    `expected an issue naming 'treatment', got ${JSON.stringify(issues)}`
  );
});

test('a group with an undefined/null level is flagged, but an empty groups.levels is NOT (that means "no groups")', () => {
  const design = { groups: { levels: [undefined, 'CT'] }, factors: [] };
  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.field === 'groups' && i.message.includes('invalid level')),
    `expected an invalid group-level issue, got ${JSON.stringify(issues)}`
  );

  assert.deepEqual(conditionIssues({ groups: { levels: [] }, factors: [] }), []);
});

// --- Replicate axes: independently optional, prefixed, zero-padded -------

test('an omitted replicate axis (null) produces one pass with that rep null, not a fabricated 1', () => {
  const design = { factors: [{ name: 'g', levels: ['WT'] }], biologicalReplicates: null, technicalReplicates: null };
  const rows = expandConditions(design);
  assert.deepEqual(rows, [{ id: 0, group: null, factorLevels: { g: 'WT' }, bioRep: null, techRep: null }]);
});

test('biological and technical replicates are independently settable and nest correctly', () => {
  const design = { factors: [], biologicalReplicates: 2, technicalReplicates: 3 };
  const rows = expandConditions(design);
  assert.equal(rows.length, 6);
  // Technical is the FASTEST-varying axis: for each bio rep, all tech reps in order.
  assert.deepEqual(
    rows.map((r) => [r.bioRep, r.techRep]),
    [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]
  );
});

test('formatReplicateToken zero-pads to 2 digits and prefixes B/T; null omits the token entirely', () => {
  assert.equal(formatReplicateToken('B', 1), 'B01');
  assert.equal(formatReplicateToken('T', 3), 'T03');
  assert.equal(formatReplicateToken('B', 12), 'B12');
  assert.equal(formatReplicateToken('B', null), '');
  assert.equal(formatReplicateToken('T', undefined), '');
});

test('an explicit replicate count < 1 or non-integer raises an issue on the correct field', () => {
  for (const bad of [-1, 0, 1.5, 'three']) {
    const issues = conditionIssues({ factors: [], biologicalReplicates: bad });
    assert.ok(
      issues.some((i) => i.field === 'biologicalReplicates'),
      `expected a biologicalReplicates issue for ${JSON.stringify(bad)}, got ${JSON.stringify(issues)}`
    );
  }
  const techIssues = conditionIssues({ factors: [], technicalReplicates: -1 });
  assert.ok(techIssues.some((i) => i.field === 'technicalReplicates'));
});

test('a replicate count above the 2-digit cap (99) raises an issue instead of silently overflowing', () => {
  const issues = conditionIssues({ factors: [], biologicalReplicates: 100 });
  assert.ok(
    issues.some((i) => i.field === 'biologicalReplicates' && /cap/i.test(i.message)),
    `expected a cap issue, got ${JSON.stringify(issues)}`
  );
  // 99 itself is still legal.
  assert.deepEqual(conditionIssues({ factors: [], biologicalReplicates: 99 }), []);
});

test('null replicates are legal (no issue) -- distinguishing "omitted" from "explicitly invalid"', () => {
  assert.deepEqual(
    conditionIssues({ factors: [], biologicalReplicates: null, technicalReplicates: null }),
    []
  );
});

// --- Reserved names: 'group', 'biorep', 'techrep' -------------------------

test('a factor named "group", "biorep", or "techrep" is flagged as reserved', () => {
  for (const reserved of ['group', 'biorep', 'techrep']) {
    const issues = conditionIssues({ factors: [{ name: reserved, levels: ['A', 'B'] }] });
    assert.ok(
      issues.some((i) => i.field === 'factors' && /reserved/i.test(i.message) && i.message.includes(reserved)),
      `expected a reserved-name issue for '${reserved}', got ${JSON.stringify(issues)}`
    );
  }
});

test('a factor named "group" collides for real once a primary group axis is also in use', () => {
  // The shadow: buildSampleId seeds `fields` from factorLevels first, then
  // OVERWRITES fields.group with the row's actual primary-group value if one exists --
  // so a factor also named 'group' gets silently shadowed the moment this
  // design defines real groups, producing identical ids for distinct rows.
  const design = {
    groups: { levels: ['X'] },
    factors: [{ name: 'group', levels: ['A', 'B'] }],
    idScheme: '{group}',
  };
  const rows = expandConditions(design);
  assert.equal(rows.length, 2);
  const ids = rows.map((row) => buildSampleId(row, design.idScheme));
  assert.equal(new Set(ids).size, 1, `expected a collision, got distinct ids ${JSON.stringify(ids)}`);
});

test('duplicate factor names raise an issue', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT'] },
      { name: 'genotype', levels: ['KO'] },
    ],
  };

  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'factors' && /duplicate/i.test(i.message) && i.message.includes('genotype')
    ),
    `expected a duplicate-factor issue, got ${JSON.stringify(issues)}`
  );
});

test('the >1000-row cap returns an issue and expandConditions does not attempt the expansion', () => {
  const design = {
    factors: [
      { name: 'a', levels: Array.from({ length: 50 }, (_, i) => `a${i}`) },
      { name: 'b', levels: Array.from({ length: 50 }, (_, i) => `b${i}`) },
    ],
  };
  // 50 * 50 = 2500 rows, well over the 1000-row cap.

  const start = Date.now();
  const rows = expandConditions(design);
  const elapsedMs = Date.now() - start;

  assert.equal(rows.length, 0);
  assert.ok(elapsedMs < 200, `expected a fast short-circuit, took ${elapsedMs}ms`);

  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.severity === 'error' && i.message.includes('2500')),
    `expected a cap issue mentioning the planned row count, got ${JSON.stringify(issues)}`
  );
});

// --- id scheme token validation -------------------------------------------

test('conditionIssues flags an unknown token in the id scheme', () => {
  const design = {
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    idScheme: '{genotype}_{batch}',
  };

  const issues = conditionIssues(design);
  assert.ok(
    issues.some(
      (i) => i.field === 'idScheme' && i.severity === 'error' && i.message.includes('batch')
    ),
    `expected an unknown-token issue naming 'batch', got ${JSON.stringify(issues)}`
  );
});

test('a reserved token is "known" for scheme validation ONLY when its axis is actually in use', () => {
  // No group levels and no technical replicates on this design -- {group} and
  // {techrep} must be reported as unknown, not silently accepted only to
  // throw "Unknown token" at render time on every row.
  const design = {
    factors: [{ name: 'genotype', levels: ['WT'] }],
    groups: { levels: [] },
    biologicalReplicates: 2,
    technicalReplicates: null,
    idScheme: '{genotype}{group}{biorep}{techrep}',
  };
  const issues = conditionIssues(design);
  const flaggedFields = issues.filter((i) => i.field === 'idScheme').map((i) => i.message);
  assert.ok(flaggedFields.some((m) => m.includes('group')), `expected 'group' flagged, got ${JSON.stringify(flaggedFields)}`);
  assert.ok(flaggedFields.some((m) => m.includes('techrep')), `expected 'techrep' flagged, got ${JSON.stringify(flaggedFields)}`);
  assert.ok(!flaggedFields.some((m) => m.includes('genotype')));
  assert.ok(!flaggedFields.some((m) => m.includes("'biorep'")));
});

test('conditionIssues does not flag group/biorep/techrep or known factor names when their axes are in use', () => {
  const design = {
    groups: { levels: ['CT', 'drug'] },
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    biologicalReplicates: 2,
    technicalReplicates: 1,
    idScheme: '{group}{genotype}B{biorep}T{techrep}',
  };
  assert.deepEqual(conditionIssues(design), []);
});

// --- buildSampleId (the "Group naming override" renderer) -----------------

test('buildSampleId throws rather than silently rendering an empty segment for an unknown token', () => {
  const row = { factorLevels: { genotype: 'WT' }, group: null, bioRep: null, techRep: null };
  assert.throws(() => buildSampleId(row, '{genotype}_{batch}'));
});

test('buildSampleId throws for a reserved token whose axis is omitted on this row', () => {
  const row = { factorLevels: {}, group: null, bioRep: 1, techRep: null };
  assert.throws(() => buildSampleId(row, '{group}'), /Unknown token/);
  assert.throws(() => buildSampleId(row, '{techrep}'), /Unknown token/);
  // biorep IS present on this row and must render fine.
  assert.equal(buildSampleId(row, '{biorep}'), '1');
});

test("buildSampleId's sanitization matches a direct sanitizeToken call for a level with a space and a slash", () => {
  const row = { factorLevels: { genotype: 'high dose / repeat value' }, group: null, bioRep: null, techRep: null };
  const scheme = '{genotype}';

  const expected = sanitizeToken(row.factorLevels.genotype, {
    safeCharPattern: SAMPLE_ID_SAFE_CHAR_PATTERN,
  });

  assert.equal(buildSampleId(row, scheme), expected);
  assert.notEqual(expected, row.factorLevels.genotype);
});

test('buildSampleId renders a multi-token scheme including group and both replicate axes', () => {
  const row = { factorLevels: { genotype: 'WT' }, group: 'drug', bioRep: 2, techRep: 3 };
  const scheme = '{group}{genotype}B{biorep}T{techrep}';

  const expected = sanitizeToken('drugWTB2T3', { safeCharPattern: SAMPLE_ID_SAFE_CHAR_PATTERN });
  assert.equal(buildSampleId(row, scheme), expected);
});

test('buildSampleId rejects a scheme token matching an inherited Object.prototype member (D4)', () => {
  const row = { factorLevels: { genotype: 'WT' }, group: null, bioRep: null, techRep: null };
  for (const badToken of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    assert.throws(
      () => buildSampleId(row, `{${badToken}}`),
      /Unknown token/,
      `expected {${badToken}} to be rejected as unknown, not resolved via the prototype chain`
    );
  }
});

test('conditionIssues returns no issues for a well-formed design', () => {
  const design = {
    groups: { levels: ['CT', 'drug'] },
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    biologicalReplicates: 3,
    idScheme: '{group}{genotype}B{biorep}',
  };
  assert.deepEqual(conditionIssues(design), []);
});

// --- Filename-uniqueness gate (new: nothing checked this before) ----------

test('the uniqueness gate fires when a custom scheme omits a factor that actually varies', () => {
  // A realistic authoring mistake: the scheme only encodes genotype, but
  // treatment also varies -- two distinct groups collapse to the same id.
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT'] },
      { name: 'treatment', levels: ['veh', 'drug'] },
    ],
    idScheme: '{genotype}',
  };
  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.severity === 'error' && /identical name segment/i.test(i.message)),
    `expected a collision issue, got ${JSON.stringify(issues)}`
  );
});

test('the uniqueness gate fires when two distinct raw levels sanitize to the identical segment', () => {
  // 'AB' and 'A B' both collapse to 'AB' once buildGroupSegments strips
  // whitespace -- a real collision, not just a superficial string mismatch.
  const design = { factors: [{ name: 'treatment', levels: ['AB', 'A B'] }] };
  const issues = conditionIssues(design);
  assert.ok(
    issues.some((i) => i.severity === 'error' && /identical name segment/i.test(i.message)),
    `expected a collision issue, got ${JSON.stringify(issues)}`
  );
});

test('the uniqueness gate does not fire when replicates alone distinguish otherwise-identical rows', () => {
  const design = { factors: [{ name: 'genotype', levels: ['WT'] }], biologicalReplicates: 3 };
  assert.deepEqual(conditionIssues(design), []);
});

test('the uniqueness gate does not double-report a scheme already flagged as having an unknown token', () => {
  const design = {
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    idScheme: '{bogus}',
  };
  const issues = conditionIssues(design);
  const collisionIssues = issues.filter((i) => /identical name segment/i.test(i.message));
  assert.equal(collisionIssues.length, 0, `expected no collision noise on top of the unknown-token issue, got ${JSON.stringify(issues)}`);
});

// --- Two-stage naming: group segments (stage 2) -------------------------
// The defect these pin: a single-token id scheme welds adjacent groups into one
// indistinguishable blob ('{control}{treatment}' -> 'CTNAM50MM'), so a reader
// cannot tell which control group and which treatment group a file belongs to.
// Segments are sanitized individually and joined afterwards, so they can't merge.

test('buildGroupSegments puts the primary group first, then one segment per factor -- replicate is NOT included', () => {
  const design = {
    groups: { levels: ['CT'] },
    factors: [{ name: 'treatment', levels: ['NAM 50mM'] }],
  };
  const rows = expandConditions(design);
  assert.equal(rows.length, 1);
  // Whitespace inside a level is REMOVED rather than becoming '_', so the only
  // punctuation in the group slot is the '-' separator. Case is left alone here
  // -- uppercasing happens later, in normalizeFields, per uppercaseFields.
  // No replicate segment: replicates render through their own template tokens.
  assert.deepEqual(buildGroupSegments(rows[0], design), ['CT', 'NAM50mM']);
});

test('a group segment never contains the field separator "_"', () => {
  const design = { factors: [{ name: 'treatment', levels: ['NAM 50 mM', 'high  dose'] }] };
  for (const row of expandConditions(design)) {
    for (const segment of buildGroupSegments(row, design)) {
      assert.ok(
        !segment.includes('_'),
        `'_' separates template FIELDS and must never appear inside a group segment, got '${segment}'`
      );
    }
  }
});

test('buildGroupLabel never merges the primary group and a factor into one indistinguishable token (the CTNAM50MM defect)', () => {
  const design = {
    groups: { levels: ['CT'] },
    factors: [{ name: 'treatment', levels: ['NAM 50mM'] }],
  };
  const rows = expandConditions(design);
  const label = buildGroupLabel(rows[0], design);

  assert.ok(
    label.includes(GROUP_SEGMENT_SEPARATOR),
    `expected a separator between the primary group and the factor, got '${label}'`
  );
  assert.ok(!label.includes('CTNAM'), `group and factor merged into one token: '${label}'`);
  assert.equal(label.split(GROUP_SEGMENT_SEPARATOR)[0], 'CT');
});

test('buildGroupSegments follows the DESIGN factor order, not the row key order', () => {
  const design = {
    factors: [
      { name: 'genotype', levels: ['WT'] },
      { name: 'treatment', levels: ['drug'] },
    ],
  };
  const row = {
    id: 0,
    group: null,
    // Deliberately inserted in the OPPOSITE order to the declared factors --
    // a row rehydrated from persisted JSON carries no ordering guarantee.
    factorLevels: { treatment: 'drug', genotype: 'WT' },
    bioRep: null,
    techRep: null,
  };
  assert.deepEqual(buildGroupSegments(row, design), ['WT', 'drug']);
});

test('buildGroupSegments omits a factor the row carries no level for', () => {
  const design = { factors: [{ name: 'genotype', levels: ['WT'] }, { name: 'dose', levels: ['high'] }] };
  const row = { id: 0, group: null, factorLevels: { genotype: 'WT' }, bioRep: null, techRep: null };
  assert.deepEqual(buildGroupSegments(row, design), ['WT']);
});

test('buildGroupSegments on a design with no groups and no factors yields an empty array', () => {
  const rows = expandConditions({ groups: { levels: [] }, factors: [] });
  assert.deepEqual(buildGroupSegments(rows[0], { groups: { levels: [] }, factors: [] }), []);
});

// --- physicalSampleCount: samples, not files (technical axis excluded) ----
// A technical replicate is a repeat MEASUREMENT of the same physical sample
// (web/kb/questions.json), so unlike the full row count, physicalSampleCount
// must ignore that axis entirely -- groups x factors x biological replicates
// only.

test('physicalSampleCount ignores the technical-replicate axis entirely', () => {
  const design = {
    groups: { levels: ['CT', 'NAM50MM'] },
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    biologicalReplicates: 2,
    technicalReplicates: 3,
  };
  // 2 groups x 2 genotypes x 2 bio reps = 8 physical samples, regardless of
  // the 3 technical replicates (which would make plannedRowCount 24).
  assert.equal(physicalSampleCount(design), 8);
  assert.equal(expandConditions(design).length, 24);
});

test('physicalSampleCount matches the full row count when there is no technical-replicate axis', () => {
  const design = {
    groups: { levels: ['CT', 'drug'] },
    factors: [{ name: 'genotype', levels: ['WT', 'KO'] }],
    biologicalReplicates: 3,
    technicalReplicates: null,
  };
  assert.equal(physicalSampleCount(design), expandConditions(design).length);
  assert.equal(physicalSampleCount(design), 12);
});

test('physicalSampleCount is total on malformed/absent design input, never throws', () => {
  assert.equal(physicalSampleCount(undefined), 1);
  assert.equal(physicalSampleCount(null), 1);
  assert.equal(physicalSampleCount({}), 1);
  assert.equal(physicalSampleCount({ factors: 'not-an-array', groups: 42 }), 1);
  // An explicit-but-invalid technical replicate count must not affect
  // physicalSampleCount at all -- the axis is excluded outright.
  assert.equal(
    physicalSampleCount({ factors: [], groups: { levels: [] }, technicalReplicates: 'bogus' }),
    1
  );
});
