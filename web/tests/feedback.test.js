import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubLoginUrl } from '../src/ui/steps/feedback.js';
import { emailFeedbackUrl } from '../src/ui/feedbackHandoff.js';

test('GitHub issue action signs in first without putting a feedback package in the URL', () => {
  const loginUrl = new URL(githubLoginUrl());
  assert.equal(loginUrl.origin, 'https://github.com');
  assert.equal(loginUrl.pathname, '/login');
  const returnTo = loginUrl.searchParams.get('return_to');
  assert.equal(returnTo, '/Daniel-Waiger/micronaut-explorer/issues/new');
  assert.doesNotMatch(loginUrl.href, /reproducible|report|body=/i);
});

test('email feedback action keeps the feedback package out of the mailto URL', () => {
  const mailto = new URL(emailFeedbackUrl());
  assert.equal(mailto.protocol, 'mailto:');
  assert.equal(mailto.searchParams.get('subject'), 'Micronaut Planner feedback');
  assert.equal(mailto.searchParams.get('body'), null);
  assert.doesNotMatch(mailto.href, /report|study|browser|body=/i);
});
