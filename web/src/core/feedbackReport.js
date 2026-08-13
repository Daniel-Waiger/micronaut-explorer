// Builds the plain-text "Copy feedback report" block (Wave 1 of the
// alpha-pilot-readiness pass). Feedback without a repro is noise, and this
// app's entire state is one JSON blob -- so instead of asking a tester to
// describe what they did from memory, the button hands them exactly what
// was on screen: the step, the browser, the knowledge-pack health, and the
// full study. They paste this into the feedback form/email alongside a
// sentence on what went wrong.
//
// Deliberately does NOT claim a build/version identifier: the project has
// no build-time git-SHA embed (unlike the KB, which IS embedded -- see
// tools/build_single_file.py), and inventing a fake "unknown" value that
// LOOKS like real data would be worse than omitting the field, matching
// this codebase's standing "never silent, never fabricated" discipline
// (see engine/spectra.js's five-state resolution for the same principle
// applied elsewhere).
//
// Pure module: no DOM. The actual clipboard write and button wiring is
// ui/shell.js's job -- this is the part worth testing under plain
// `node --test`, the same split naming.js's copy-full-name button and
// ui/clipboard.js already use.

import { serializeExperiment } from './persist.js';

/**
 * `{currentStepId, kbIssueCount, userAgent, experiment, now}` -> report
 * text. `now` is injectable (defaults to `new Date()`) so a test can pin
 * the timestamp; every other field degrades to a labeled placeholder rather
 * than `undefined` leaking into the text a tester pastes somewhere. TOTAL:
 * never throws -- a malformed `experiment` still serializes via
 * serializeExperiment (JSON.stringify tolerates any plain-data shape).
 */
export function buildFeedbackReport({ currentStepId, kbIssueCount, userAgent, experiment, now } = {}) {
  const timestamp = now instanceof Date ? now : new Date();
  const lines = [
    'Micronaut Planner -- feedback report',
    `Generated: ${timestamp.toISOString()}`,
    `Step: ${currentStepId || '(unknown)'}`,
    `Knowledge-pack issues: ${typeof kbIssueCount === 'number' ? kbIssueCount : '(unknown)'}`,
    `Browser: ${userAgent || '(unknown)'}`,
    '',
    'What were you trying to do, and what happened instead?',
    '(describe here, then paste this whole report)',
    '',
    '--- study JSON (lets us reproduce exactly what you saw) ---',
    serializeExperiment(experiment ?? null),
  ];
  return lines.join('\n');
}
