import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureWalkthroughVisit, FEATURE_TOUR_AWAY_MS } from '../src/core/featureWalkthroughVisit.js';

function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

test('first tab session is eligible and a refresh in the same tab is not', () => {
  const persistent = storage();
  const tab = storage();
  assert.equal(createFeatureWalkthroughVisit({ localStorage: persistent, sessionStorage: tab, now: () => 100 }).shouldStartNow(), true);
  assert.equal(createFeatureWalkthroughVisit({ localStorage: persistent, sessionStorage: tab, now: () => 100 }).shouldStartNow(), false);
});

test('a new tab starts the tour only after 24 hours away', () => {
  const now = FEATURE_TOUR_AWAY_MS + 10_000_000;
  const recent = createFeatureWalkthroughVisit({ localStorage: storage({ 'micronaut.featureTour.lastActiveAt': now - FEATURE_TOUR_AWAY_MS + 1 }), sessionStorage: storage(), now: () => now });
  const overdue = createFeatureWalkthroughVisit({ localStorage: storage({ 'micronaut.featureTour.lastActiveAt': now - FEATURE_TOUR_AWAY_MS }), sessionStorage: storage(), now: () => now });
  assert.equal(recent.shouldStartNow(), false);
  assert.equal(overdue.shouldStartNow(), true);
});

test('a long-hidden open tab becomes eligible on its return', () => {
  let time = 500;
  const visit = createFeatureWalkthroughVisit({ localStorage: storage(), sessionStorage: storage(), now: () => time });
  visit.markHidden();
  time += FEATURE_TOUR_AWAY_MS - 1;
  assert.equal(visit.shouldStartOnReturn(), false);
  visit.markHidden();
  time += FEATURE_TOUR_AWAY_MS;
  assert.equal(visit.shouldStartOnReturn(), true);
});

test('storage failures do not throw and only make the first-tab fallback eligible', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const visit = createFeatureWalkthroughVisit({ localStorage: blocked, sessionStorage: blocked, now: () => 1 });
  assert.doesNotThrow(() => visit.markHidden());
  assert.doesNotThrow(() => visit.markLeaving());
  assert.equal(visit.shouldStartNow(), true);
});
