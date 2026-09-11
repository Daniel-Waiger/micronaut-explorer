import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compassScopeLine, footerPositionLabel } from '../src/ui/shell.js';

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

// The nav step badges (:641/:657 in the original spec numbering) are
// stateLabel's only remaining consumer, and its subject is a ROUTE -- that
// must not change as a side effect of the pill fix above.
test('stateLabel and the nav step badge keep their original route vocabulary, unchanged', () => {
  assert.match(shell, /function stateLabel\(state\) \{\s*return \{\s*'not-started': 'Not started',\s*'in-progress': 'In progress',\s*'needs-attention': 'Decision needed',\s*complete: 'Ready for now',\s*\}\[state\] \|\| 'Not started';\s*\}/);
  assert.match(shell, /badge\.className = `nav-step-badge is-\$\{current\.state\}`/);
  assert.match(shell, /badge\.textContent = stateLabel\(current\.state\)/);
  assert.match(shell, /const accessibleLabel = current \? `\$\{label\} — \$\{stateLabel\(current\.state\)\}` : label;/);
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
