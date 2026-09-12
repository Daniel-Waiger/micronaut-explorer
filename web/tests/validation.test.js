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

// --- V4-N1 (retry): validateFields deliberately does NOT compute or fold in
// sanitization-loss issues (a group/factor level, or another naming field,
// losing a real letter/digit when turned into a filename token) -- it is
// only ever given the already-*finalized* fields, and the original
// pre-sanitization value cannot be recovered from a sanitized token. That
// responsibility belongs to naming.js's sanitizationLossIssues(raw, config),
// called directly by engine/plan.js's planFilenames (which is the one place
// a group/factor level's raw value is available) and attached to each
// planned row; engine/conformance.js folds those into the study report
// itself, not through validateFields. This test pins the negative half of
// that contract: an ordinary own-enumerable field named exactly like the
// OLD hidden channel is just a field, not a magic side-channel -- it must
// not resurrect the old behaviour, and it must not crash.
test('validateFields does not special-case a field literally named __namingSanitizationIssues', () => {
  const profile = defaultProfile();
  const fields = {
    exptype: 'CT',
    sample: 'E02',
    magnification: 'X90',
    markers: 'GFP',
    notes: 'OK',
    __namingSanitizationIssues: 'not-an-issues-array',
  };
  const issues = validateFields(fields, profile);
  assert.deepEqual(issues, []);
});

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

// --- V2-NEW-04: the contract is fixed as a FILENAME-length check, not a ---
// full-path check, because every real caller (ui/steps/naming.js:469,
// ui/steps/design.js:505, engine/conformance.js:107) has only ever passed a
// bare filename, and this app has no target-directory field to prepend --
// see validateTargetPath's own updated docstring for the full reasoning.
// The old message's closing "Full path: '<path>'" contradicted its own
// opening "This filename would be..." clause; fixed so both halves agree.
test('validateTargetPath describes its input as a filename, not a full path', () => {
  const longName = 'a'.repeat(MAX_PATH_LENGTH + 10) + '.tif';
  const [issue] = validateTargetPath(longName);
  assert.ok(issue.message.includes('This filename would be'), issue.message);
  assert.ok(issue.message.includes(`Filename: '${longName}'`), issue.message);
  assert.ok(!issue.message.includes('Full path'), issue.message);
});
