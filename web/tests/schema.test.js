import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, emptyExperiment, migrate } from '../src/core/schema.js';

test('emptyExperiment returns an object with all top-level Experiment keys', () => {
  const exp = emptyExperiment();
  const expectedKeys = [
    'schemaVersion',
    'meta',
    'narrative',
    'specimen',
    'design',
    'panel',
    'acquisition',
    'controls',
    'naming',
    'provenance',
    'derived',
    'interview',
    'conformance',
  ];
  for (const key of expectedKeys) {
    assert.ok(key in exp, `missing top-level key: ${key}`);
  }
});

test('emptyExperiment stamps the current schema version', () => {
  const exp = emptyExperiment();
  assert.equal(exp.schemaVersion, SCHEMA_VERSION);
});

test('emptyExperiment design has factors/replicates/idScheme/conditions', () => {
  const exp = emptyExperiment();
  assert.deepEqual(exp.design.factors, []);
  assert.equal(exp.design.replicates, null);
  assert.equal(exp.design.idScheme, '');
  assert.deepEqual(exp.design.conditions, []);
});

test('emptyExperiment naming carries a default template, empty fields, empty plannedNames', () => {
  const exp = emptyExperiment();
  assert.equal(
    exp.naming.template,
    '{date}_{exptype}_{sample}_{magnification}_{markers}_{notes}{ext}'
  );
  assert.deepEqual(exp.naming.fields, {});
  assert.deepEqual(exp.naming.plannedNames, []);
});

test('emptyExperiment provenance has slots/unanswered/skipped', () => {
  const exp = emptyExperiment();
  assert.deepEqual(exp.provenance.slots, {});
  assert.deepEqual(exp.provenance.unanswered, []);
  assert.deepEqual(exp.provenance.skipped, []);
});

test('emptyExperiment calls are independent objects (no shared references)', () => {
  const a = emptyExperiment();
  const b = emptyExperiment();
  a.naming.fields.foo = 'bar';
  assert.deepEqual(b.naming.fields, {});
});

test('migrate no-ops at the current schema version', () => {
  const exp = emptyExperiment();
  const migrated = migrate(exp);
  assert.equal(migrated, exp);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
});

test('migrate throws a clear error on a future schema version', () => {
  const future = emptyExperiment();
  future.schemaVersion = SCHEMA_VERSION + 1;
  assert.throws(() => migrate(future), /newer than this app supports/);
});

test('migrate throws when no migration path exists from an older version', () => {
  const stale = emptyExperiment();
  stale.schemaVersion = 0;
  assert.throws(() => migrate(stale), /No migration path/);
});
