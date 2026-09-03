import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_TOUR, featureTourRouteIds } from '../src/ui/featureWalkthrough.js';

// The tour visits the three planning workspaces plus Review. It deliberately
// does NOT visit every route: a tour long enough to cover the whole app is a
// symptom of an interface that does not explain itself, and this one is short
// enough that a person will finish it.
test('the feature walkthrough visits the planning workspaces and stays short', () => {
  assert.deepEqual(featureTourRouteIds(), ['home', 'study', 'measurement', 'overview']);
  assert.ok(FEATURE_TOUR.length <= 8, 'a tour this long stops being a tour');
  assert.ok(FEATURE_TOUR.every((item) => item.selector && item.title && item.body));
  // Every stop must name a route that still exists, or the tour dead-ends.
  const routes = new Set(['home', 'describe', 'study', 'measurement', 'overview', 'guide', 'feedback', 'settings']);
  assert.ok(FEATURE_TOUR.every((item) => item.routeId === null || routes.has(item.routeId)));
});

test('feature walkthrough copy stays concise and routes are finite selector stops', () => {
  for (const item of FEATURE_TOUR) {
    const sentenceCount = item.body.split(/[.!?]+/).filter((part) => part.trim()).length;
    assert.ok(sentenceCount <= 2, `${item.title} exceeds the two-sentence tour limit`);
    assert.ok(item.selector.startsWith('.') || item.selector.startsWith('['), `${item.title} needs a stable selector`);
  }
});

// Any stop pointing into a collapsed disclosure must say which one to open,
// or it highlights a region nobody can see.
test('tour stops inside collapsed areas declare their disclosure owner', () => {
  for (const item of FEATURE_TOUR) {
    if (!item.selector.startsWith('[data-tour-section=')) continue;
    assert.ok(item.revealSelector?.startsWith('[data-tour-section='), `${item.title} needs a revealSelector`);
  }
});
