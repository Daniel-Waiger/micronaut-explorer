import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubLoginUrl } from '../src/ui/steps/feedback.js';
import { FEEDBACK_EMAIL, emailFeedbackUrl, feedbackEmailAvailable } from '../src/ui/feedbackHandoff.js';

test('GitHub issue action signs in first without putting a feedback package in the URL', () => {
  const loginUrl = new URL(githubLoginUrl());
  assert.equal(loginUrl.origin, 'https://github.com');
  assert.equal(loginUrl.pathname, '/login');
  const returnTo = loginUrl.searchParams.get('return_to');
  // GitHub decodes return_to and redirects the signed-in user straight there,
  // so the destination -- issue path AND its own `labels` query -- must
  // survive as one opaque value, not be split across two query strings that
  // GitHub's login redirect would only carry one of.
  assert.equal(returnTo, '/Daniel-Waiger/micronaut-explorer/issues/new?labels=feedback');
  assert.doesNotMatch(loginUrl.href, /reproducible|report|body=/i);
});

// GitHub's new-issue form pre-applies any label named in its OWN query string
// -- this is the entire "feedback folder" mechanism: no server, no token, just
// a label the repo must already define (see gh CLI note in the PR/commit).
test('the GitHub destination requests the feedback label', () => {
  const loginUrl = new URL(githubLoginUrl());
  const returnTo = new URL(loginUrl.searchParams.get('return_to'), 'https://github.com');
  assert.equal(returnTo.pathname, '/Daniel-Waiger/micronaut-explorer/issues/new');
  assert.equal(returnTo.searchParams.get('labels'), 'feedback');
});

test('a configured email action addresses a real recipient and carries no package', () => {
  const mailto = new URL(emailFeedbackUrl('planner-feedback@example.org'));
  assert.equal(mailto.protocol, 'mailto:');
  assert.equal(mailto.pathname, 'planner-feedback@example.org');
  assert.equal(mailto.searchParams.get('subject'), 'Micronaut Planner feedback');
  assert.equal(mailto.searchParams.get('body'), null);
  assert.doesNotMatch(mailto.href, /report|study|browser|body=/i);
});

// A mailto: with no recipient opens an empty compose window: the button looks
// like it works and every message sent through it is lost. Unconfigured must
// therefore be UNAVAILABLE, not "available but blank" -- ui/steps/feedback.js
// omits the action entirely on this signal.
test('an unconfigured email action is unavailable rather than recipient-less', () => {
  for (const unset of ['', '   ', null, undefined]) {
    assert.equal(feedbackEmailAvailable(unset), false);
    assert.equal(emailFeedbackUrl(unset), null);
  }
});

test('the shipped default is unconfigured until a real inbox is supplied', () => {
  assert.equal(feedbackEmailAvailable(FEEDBACK_EMAIL), FEEDBACK_EMAIL.trim() !== '');
  if (FEEDBACK_EMAIL.trim() === '') assert.equal(emailFeedbackUrl(), null);
});
