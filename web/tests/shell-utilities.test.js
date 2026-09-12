import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compassScopeLine, footerPositionLabel, restoreWhenLabel } from '../src/ui/shell.js';

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');

test('the Utilities control that owns Restore is present and not globally hidden', () => {
  assert.match(shell, /utilityToggle\.textContent\s*=\s*['"]Utilities['"]/);
  assert.match(shell, /restoreTitle\.textContent\s*=\s*['"]Restore previous version['"]/);
  assert.doesNotMatch(css, /\.shell-utilities\s*\{\s*display:\s*none\s*;\s*\}/);
  assert.match(css, /\.shell-utility-toggle\s*\{[\s\S]*?display:\s*inline-flex\s*;/);
});

// AUD-09: the switcher pill's badge must speak the measurement's own
// { headline, tone } status vocabulary (measurementStatus.js), not the
// route-scoped stateLabel()/assayState() words -- and the now-dead
// assayState() must actually be gone rather than merely unused.
test('the switcher pill reads workflowProgress.assays[i].status, not the retired assayState/stateLabel route vocabulary', () => {
  assert.doesNotMatch(shell, /assayState/);
  assert.match(shell, /measurementStatusFor\(assay\.id\)/);
  assert.match(shell, /measurementStatusLabel\(status\.headline\.scope,\s*status\.headline\.status\)/);
  assert.match(shell, /MEASUREMENT_TONE_CLASS\[status\.tone\]/);
});

// stateLabel keeps its route vocabulary for every STUDY-level nav step
// (Study map, Research brief, Measurements, Review) -- those aren't the
// R4-08 disagreement and must not change as a side effect of the fix below.
test('stateLabel keeps its route vocabulary, unchanged', () => {
  assert.match(shell, /function stateLabel\(state\) \{\s*return \{\s*'not-started': 'Not started',\s*'in-progress': 'In progress',\s*'needs-attention': 'Decision needed',\s*complete: 'Ready for now',\s*\}\[state\] \|\| 'Not started';\s*\}/);
});

// R4-08: the same measurement read 'In progress' in the nav, 'Checks pass'
// on the switcher pill, and 'Checks pass'/'Defined'/'Ready to acquire' in the
// registry -- three vocabularies for one state. The per-measurement nav
// entry must now read the ACTIVE measurement's own headline off
// workflowProgress.assays[i].status, the same record the pill (AUD-09 above)
// and the registry row already read -- not the 'measurement' primary step's
// cross-assay aggregate, and not a fourth mapping invented for the nav.
test('the per-measurement nav badge reads the active measurement\'s own headline, not the route aggregate', () => {
  assert.match(shell, /const activeStatus = isMeasurementStep \? measurementStatusFor\(store\.get\(\)\.activeAssayId\) : null;/);
  assert.match(shell, /measurementStatusLabel\(activeStatus\.headline\.scope,\s*activeStatus\.headline\.status\)/);
  assert.match(shell, /MEASUREMENT_TONE_CLASS\[activeStatus\.tone\]/);
  assert.match(shell, /badgeEl\.className = `nav-step-badge is-\$\{badge\.state\}`/);
  assert.match(shell, /const accessibleLabel = badge \? `\$\{label\} — \$\{badge\.text\}` : label;/);
});

// footerPositionLabel(steps, activeId): a primary route gets its ordinal
// position; Settings, Feedback and Guide each name THEMSELVES via their own
// `title` instead of every route absent from the primary five claiming to be
// "Guide (optional)".
test('footerPositionLabel gives primary routes their step count and lets each utility route name itself', () => {
  const steps = [
    { id: 'home', title: 'Study map' },
    { id: 'describe', title: 'Research brief' },
    { id: 'study', title: 'Measurements' },
    { id: 'measurement', title: 'Measurement' },
    { id: 'overview', title: 'Review' },
    { id: 'guide', title: 'Guide' },
    { id: 'feedback', title: 'Feedback', utility: true },
    { id: 'settings', title: 'Settings', utility: true },
  ];
  assert.equal(footerPositionLabel(steps, 'describe'), 'Step 2 of 5');
  assert.equal(footerPositionLabel(steps, 'overview'), 'Step 5 of 5');
  assert.equal(footerPositionLabel(steps, 'settings'), 'Settings');
  assert.equal(footerPositionLabel(steps, 'feedback'), 'Feedback');
  assert.equal(footerPositionLabel(steps, 'guide'), 'Guide');
});

// compassScopeLine(routeId, measurementLabel): Research brief (describe)
// names its suggestions' target rather than claiming to "edit" the
// measurement; Review (overview) gets a non-editing phrasing for its
// read-only page; the measurement page keeps the original editing phrasing.
// An empty/missing measurement label must never leave a dangling
// "Now editing: " with nothing after it.
test('compassScopeLine gives describe a suggestions-target phrasing and Review a non-editing phrasing', () => {
  assert.equal(compassScopeLine('describe', 'Oregano assay'), 'Suggestions target: Oregano assay');
  assert.equal(compassScopeLine('measurement', 'Oregano assay'), 'Now editing: Measurement: Oregano assay');
  assert.equal(compassScopeLine('overview', 'Oregano assay'), 'Reviewing: Whole study');
  assert.equal(compassScopeLine('study', ''), 'Now editing: Whole study');
});

test('compassScopeLine never renders a dangling "Now editing: " for an empty scope', () => {
  for (const line of [
    compassScopeLine('measurement', ''),
    compassScopeLine('describe', ''),
    compassScopeLine('overview', ''),
    compassScopeLine(undefined, undefined),
  ]) {
    assert.notEqual(line.trim(), 'Now editing:');
    assert.ok(line.length > 'Now editing: '.length || !line.startsWith('Now editing: '));
  }
});

// restoreWhenLabel(iso): the Restore list's "when was this saved" line.
// recoveryEntries() (appController.js, not this file's to touch) returns
// savedAt: null for every slot saved before that field existed -- so the
// invalid-input branches below are not edge cases, they are what every
// upgrading user's oldest saved slots look like on first load, and this
// function's contract is to degrade to '' for every one of them rather than
// ever render "Invalid Date".
test('restoreWhenLabel: recent saves read as relative time', () => {
  // Frozen clock, not Date.now(). Asserting an exact string against the wall
  // clock races the machine: these tests read the clock once to build the
  // timestamp and the function reads it again, so a stall of one second
  // between the two turns '45s ago' into '46s ago' and fails the suite for a
  // reason unrelated to the code. Injecting the instant removes the race
  // instead of hiding it behind a tolerance.
  const NOW = Date.parse('2026-09-11T12:00:00.000Z');
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const at = (ms) => restoreWhenLabel(ago(ms), { now: () => NOW });

  assert.equal(at(3_000), 'just now');
  assert.equal(at(45_000), '45s ago');
  assert.equal(at(5 * 60_000), '5m ago');
  assert.equal(at(59 * 60_000), '59m ago');
  assert.equal(at(2 * 3_600_000), '2h ago');
  assert.equal(at(23 * 3_600_000), '23h ago');
  // The exact cutovers, which a tolerance-based test would paper over.
  assert.equal(at(9_999), 'just now');
  assert.equal(at(10_000), '10s ago');
  assert.equal(at(24 * 3_600_000 - 1), '23h ago');
  assert.doesNotMatch(at(24 * 3_600_000), /ago$/, 'a day old switches to an absolute date');
});

test('restoreWhenLabel: a save a day or more old reads as an absolute local date, not a climbing hour count', () => {
  const NOW = Date.parse('2026-09-11T12:00:00.000Z');
  const iso = new Date(NOW - 3 * 24 * 3_600_000).toISOString();
  const expected = new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const label = restoreWhenLabel(iso, { now: () => NOW });
  assert.equal(label, expected);
  assert.doesNotMatch(label, /ago$/);
});

test('restoreWhenLabel returns \'\' for null, undefined, a non-string, and an unparseable string -- never "Invalid Date"', () => {
  for (const bad of [null, undefined, 1_700_000_000_000, {}, [], 'not-a-date', '']) {
    const label = restoreWhenLabel(bad);
    assert.equal(label, '');
    assert.doesNotMatch(String(label), /Invalid Date/);
  }
});

// renderRecoveryEntries (shell.js): action()'s shared textContent-setting
// helper (used by four other menu items) must stay untouched, so the second
// line is appended to the button it returns rather than folded into the
// label action() itself builds.
test('the restore row appends a second-line span for the save time instead of changing the shared action() helper', () => {
  assert.match(shell, /function action\(label, callback, className = '', role = 'menuitem'\) \{\s*const button = document\.createElement\('button'\);\s*button\.type = 'button';\s*button\.className = `shell-utility-action \$\{className\}`\.trim\(\);\s*button\.setAttribute\('role', role\);\s*button\.textContent = label;/);
  assert.match(shell, /const whenLabel = restoreWhenLabel\(entry\.savedAt\);/);
  assert.match(shell, /when\.className = 'shell-restore-when';/);
  assert.match(shell, /restore\.appendChild\(when\);/);
});

// Accessibility: with the second text node present, the button's default
// accessible name (its concatenated text content) would run the title and
// the time together with no separator. aria-hidden takes the visual-only
// second line out of that computation; the explicit aria-label on the
// button puts the same two facts back in as one properly punctuated phrase.
test('the appended time span is hidden from the accessible name, which is instead set explicitly on the button', () => {
  assert.match(shell, /when\.setAttribute\('aria-hidden', 'true'\)/);
  // D1/V5-NEW-03: the accessible name now always names the entry's position
  // (`version i of n`) so rows sharing a title and a rendered time are still
  // distinguishable to a screen reader -- it is set unconditionally, not only
  // when a when-label exists.
  assert.match(shell, /restore\.setAttribute\('aria-label', `\$\{entryTitle\}, version \$\{version\} of \$\{total\}, saved \$\{whenLabel \|\| 'an unknown time'\}`\)/);
});

// Everything renderRecoveryEntries already did must survive untouched: the
// "Latest: " prefix on index 0, the delete button's stopPropagation, and its
// version-qualified aria-label (D1/V5-NEW-03) and confirm string.
test('the restore row keeps its existing Latest prefix, delete control, and confirm strings intact', () => {
  assert.match(shell, /const titleLine = `\$\{index === 0 \? 'Latest: ' : ''\}\$\{entryTitle\}`;/);
  // D1: the confirm dialog states the ring's real bound (persist.js's
  // PROTECTED_CAP = 3) instead of the old unqualified "remains available"
  // promise (V6-NEW-01/B2 red-team problem 6).
  assert.match(shell, /window\.confirm\('Restore this saved version\? Your current work is kept as a protected snapshot in Restore \(Restore keeps five versions; the most recent snapshots are protected first\)\.'\)/);
  assert.match(shell, /remove\.setAttribute\('aria-label', `Permanently delete the saved version "\$\{entryTitle\}", version \$\{version\} of \$\{total\}`\)/);
  assert.match(shell, /event\.stopPropagation\(\);/);
  assert.match(shell, /window\.confirm\(`Permanently delete the saved version "\$\{entryTitle\}"\? This cannot be undone\.`\)/);
});

// CSS: the second line must actually stack under the title (display: block
// -- a bare <span> is inline and would run on after the title text instead),
// and must draw its colour from an existing custom property rather than a
// hardcoded one, since app.css supports light, dark and two explicit
// [data-theme] blocks from a single rule.
test('app.css stacks .shell-restore-when on its own line using an existing muted-text token', () => {
  assert.match(css, /\.shell-restore-when\s*\{[^}]*display:\s*block;[^}]*\}/);
  assert.match(css, /\.shell-restore-when\s*\{[^}]*color:\s*var\(--muted\);[^}]*\}/);
  assert.doesNotMatch(css.match(/\.shell-restore-when\s*\{[^}]*\}/)[0], /#[0-9a-fA-F]{3,8}\b/);
});
