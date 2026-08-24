import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_TOUR, featureTourRouteIds } from '../src/ui/featureWalkthrough.js';

test('feature walkthrough covers every app workspace after the shared shell stops', () => {
  assert.deepEqual(featureTourRouteIds(), [
    'home', 'describe', 'study', 'design', 'panel', 'naming', 'overview', 'guide', 'feedback', 'settings',
  ]);
  assert.ok(FEATURE_TOUR.some((item) => item.routeId === null && item.selector === '.shell-new-study'));
  assert.ok(FEATURE_TOUR.every((item) => item.selector && item.title && item.body));
});

test('feature walkthrough copy stays concise and routes are finite selector stops', () => {
  for (const item of FEATURE_TOUR) {
    const sentenceCount = item.body.split(/[.!?]+/).filter((part) => part.trim()).length;
    assert.ok(sentenceCount <= 2, `${item.title} exceeds the two-sentence tour limit`);
    assert.ok(item.selector.startsWith('.') || item.selector.startsWith('['), `${item.title} needs a stable selector`);
  }
});

test('collapsed Acquisition areas used by tour stops declare their disclosure owner', () => {
  const panelStops = FEATURE_TOUR.filter((item) => item.routeId === 'panel');
  assert.equal(panelStops.length, 4);
  assert.ok(panelStops.every((item) => item.revealSelector?.startsWith('[data-tour-section=')));
});
