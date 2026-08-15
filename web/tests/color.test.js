// Tests for engine/color.js: the emission-peak -> display-color mapping
// used by the Color panel step's swatches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wavelengthToColor } from '../src/engine/color.js';

test('wavelengthToColor returns null for a non-finite/missing peak', () => {
  assert.equal(wavelengthToColor(null), null);
  assert.equal(wavelengthToColor(undefined), null);
  assert.equal(wavelengthToColor(NaN), null);
  assert.equal(wavelengthToColor('461'), null);
});

test('wavelengthToColor returns a well-formed #rrggbb hex string', () => {
  const hex = wavelengthToColor(461);
  assert.match(hex, /^#[0-9a-f]{6}$/);
});

test('wavelengthToColor(461) -- DAPI-like emission -- lands in the blue/cyan hue family, not red or green', () => {
  const hex = wavelengthToColor(461);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  assert.ok(b > r && b > g, `expected blue-dominant color for DAPI, got ${hex}`);
});

test('wavelengthToColor(510) -- GFP-like emission -- lands green-dominant', () => {
  const hex = wavelengthToColor(510);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  assert.ok(g > r && g > b, `expected green-dominant color for GFP, got ${hex}`);
});

test('wavelengthToColor(615) -- Texas Red-like emission -- lands red-dominant', () => {
  const hex = wavelengthToColor(615);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  assert.ok(r > g && r > b, `expected red-dominant color for Texas Red, got ${hex}`);
});

test('wavelengthToColor clamps out-of-range peaks instead of throwing', () => {
  assert.match(wavelengthToColor(50), /^#[0-9a-f]{6}$/);
  assert.match(wavelengthToColor(5000), /^#[0-9a-f]{6}$/);
});

test('wavelengthToColor is deterministic', () => {
  assert.equal(wavelengthToColor(647), wavelengthToColor(647));
});
