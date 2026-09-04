// Verbatim-intent port of tests/test_validation.py.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PATH_LENGTH,
  validateFields,
  validateTargetPath,
} from '../src/engine/validation.js';

function defaultProfile() {
  return {
    name: 'default',
    allowedExperimentTypes: [],
    allowedMarkers: [],
    samplePattern: '^[A-Za-z0-9_-]+$',
    magnificationPattern: '^[A-Za-z0-9]+$',
    notesPattern: '^[A-Za-z0-9_-]+$',
    unknownMarkerPolicy: 'warn',
  };
}

test('validateFields happy path has no issues', () => {
  const profile = defaultProfile();
  const fields = {
    exptype: 'CT',
    sample: 'E02',
    magnification: 'X90',
    markers: 'GFP-DAPI',
    notes: 'OK_01',
  };
  assert.deepEqual(validateFields(fields, profile), []);
});

test('validateFields allows mixed-case notes', () => {
  const profile = defaultProfile();
  const fields = {
    exptype: 'CT',
    sample: 'E02',
    magnification: 'X90',
    markers: 'GFP-DAPI',
    notes: 'Trial-1b',
  };
  const issues = validateFields(fields, profile);
  assert.ok(!issues.some((issue) => issue.field === 'notes'));
});

test('validateFields reports pattern and allow-list errors on a restrictive profile', () => {
  // The default profile is neutral/permissive, so this exercises an explicit
  // restrictive profile to prove pattern/allow-list errors are still reported
  // when a lab actually configures restrictions.
  const profile = {
    name: 'restrictive',
    allowedExperimentTypes: ['CT'],
    allowedMarkers: ['GFP'],
    samplePattern: '^E\\d{2}$',
    magnificationPattern: '^X\\d{2,3}$',
    notesPattern: '^[A-Za-z0-9_-]+$',
    unknownMarkerPolicy: 'warn',
  };
  const fields = {
    exptype: 'BAD',
    sample: 'sample-02',
    magnification: '90x',
    markers: 'GFP-UNKNOWN',
    notes: 'bad note',
  };
  const issues = validateFields(fields, profile);
  const byField = Object.fromEntries(issues.map((issue) => [issue.field, issue]));

  assert.equal(byField.exptype.severity, 'error');
  assert.equal(byField.sample.severity, 'error');
  assert.equal(byField.magnification.severity, 'error');
  assert.equal(byField.notes.severity, 'error');
  assert.ok(['warning', 'error'].includes(byField.markers.severity));
});

test('default profile empty allow-lists mean unrestricted', () => {
  const profile = defaultProfile();
  const fields = {
    exptype: 'FOO',
    sample: 'sample-01',
    magnification: '10x',
    markers: 'WHATEVER-ELSE',
    notes: 'note_1',
  };
  assert.deepEqual(validateFields(fields, profile), []);

  // The same novel exptype/markers are still flagged once a lab opts into an
  // explicit restrictive profile.
  const restrictive = {
    ...profile,
    name: 'restrictive',
    allowedExperimentTypes: ['CT'],
    allowedMarkers: ['GFP'],
  };
  const restrictedIssues = validateFields(fields, restrictive);
  const byField = Object.fromEntries(restrictedIssues.map((issue) => [issue.field, issue]));
  assert.equal(byField.exptype.severity, 'error');
  assert.equal(byField.markers.severity, 'warning');
});

test('unknownMarkerPolicy warn and allow', () => {
  const profileWarn = {
    name: 'warn',
    allowedExperimentTypes: ['CT'],
    allowedMarkers: ['GFP'],
    samplePattern: '^E\\d{2}$',
    magnificationPattern: '^X\\d{2,3}$',
    notesPattern: '^[A-Z0-9_-]+$',
    unknownMarkerPolicy: 'warn',
  };
  const warnIssues = validateFields(
    { exptype: 'CT', sample: 'E01', magnification: 'X90', markers: 'GFP-XYZ', notes: 'OK' },
    profileWarn
  );
  assert.ok(warnIssues.some((i) => i.field === 'markers' && i.severity === 'warning'));

  const profileAllow = { ...profileWarn, name: 'allow', unknownMarkerPolicy: 'allow' };
  const allowIssues = validateFields(
    { exptype: 'CT', sample: 'E01', magnification: 'X90', markers: 'GFP-XYZ', notes: 'OK' },
    profileAllow
  );
  assert.ok(!allowIssues.some((i) => i.field === 'markers'));
});

test('validateTargetPath warns when over MAX_PATH_LENGTH', () => {
  const longPath = 'C:/' + 'a'.repeat(MAX_PATH_LENGTH + 50) + '.tif';
  const issues = validateTargetPath(longPath);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'warning');
  assert.equal(issues[0].field, 'target_path');
  // Plain language, not the Win32 constant name -- a user reading this
  // message never needs to know it's called MAX_PATH internally.
  assert.ok(issues[0].message.includes('Windows'));
  assert.ok(issues[0].message.includes(String(MAX_PATH_LENGTH)));
  // The offending path must be visible in the message, not summarized away.
  assert.ok(issues[0].message.includes(longPath));
});

test('validateTargetPath is silent when within limit', () => {
  assert.deepEqual(validateTargetPath('C:/data/sample.tif'), []);
});

test('validateTargetPath boundary is inclusive', () => {
  // Exactly MAX_PATH_LENGTH characters must NOT warn; MAX_PATH_LENGTH + 1 must.
  const exact = 'a'.repeat(MAX_PATH_LENGTH);
  const over = 'a'.repeat(MAX_PATH_LENGTH + 1);

  assert.deepEqual(validateTargetPath(exact), []);
  assert.equal(validateTargetPath(over).length, 1);
});
