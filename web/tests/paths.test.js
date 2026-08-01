import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPath, setPath, listPaths } from '../src/core/paths.js';

test('setPath creates nested objects and arrays, getPath round-trips', () => {
  const obj = {};
  setPath(obj, 'a.b[0].c', 42);
  assert.equal(obj.a.b[0].c, 42);
  assert.equal(getPath(obj, 'a.b[0].c'), 42);
});

test('setPath creates a plain nested object path', () => {
  const obj = {};
  setPath(obj, 'x.y.z', 'hello');
  assert.deepEqual(obj, { x: { y: { z: 'hello' } } });
  assert.equal(getPath(obj, 'x.y.z'), 'hello');
});

test('setPath handles an array index at the top level', () => {
  const obj = {};
  setPath(obj, 'list[2]', 'third');
  assert.ok(Array.isArray(obj.list));
  assert.equal(obj.list[2], 'third');
  assert.equal(getPath(obj, 'list[2]'), 'third');
});

test('setPath overwrites an existing value at a path', () => {
  const obj = { a: { b: 1 } };
  setPath(obj, 'a.b', 2);
  assert.equal(obj.a.b, 2);
});

test('getPath returns undefined for a missing path', () => {
  const obj = { a: { b: 1 } };
  assert.equal(getPath(obj, 'a.c'), undefined);
  assert.equal(getPath(obj, 'x.y.z'), undefined);
  assert.equal(getPath(obj, 'a.b[0].c'), undefined);
});

test('getPath returns undefined when traversing through null', () => {
  const obj = { a: null };
  assert.equal(getPath(obj, 'a.b'), undefined);
});

test('listPaths resolves a simple non-wildcard path to itself', () => {
  const obj = { a: { b: [{ c: 1 }] } };
  assert.deepEqual(listPaths(obj, 'a.b[0].c'), ['a.b[0].c']);
});

test('listPaths fans out a [*] wildcard over an array', () => {
  const obj = { a: { b: [{ c: 1 }, { c: 2 }, { c: 3 }] } };
  assert.deepEqual(listPaths(obj, 'a.b[*].c'), ['a.b[0].c', 'a.b[1].c', 'a.b[2].c']);
});

test('listPaths returns an empty array when the wildcard target is missing or not an array', () => {
  const obj = { a: {} };
  assert.deepEqual(listPaths(obj, 'a.b[*].c'), []);
  const obj2 = { a: { b: 'not-an-array' } };
  assert.deepEqual(listPaths(obj2, 'a.b[*].c'), []);
});

test('listPaths handles a wildcard at the top level of an array of primitives', () => {
  const obj = { tags: ['x', 'y'] };
  assert.deepEqual(listPaths(obj, 'tags[*]'), ['tags[0]', 'tags[1]']);
});

test('setPath rejects __proto__ to prevent prototype pollution', () => {
  const obj = {};
  assert.throws(() => setPath(obj, '__proto__.polluted', 'yes'), /unsafe path segment/);
  assert.equal({}.polluted, undefined);
});

test('setPath rejects constructor.prototype to prevent prototype pollution', () => {
  const obj = {};
  assert.throws(() => setPath(obj, 'constructor.prototype.polluted', 'yes'), /unsafe path segment/);
  assert.equal({}.polluted, undefined);
});

test('getPath also rejects a dangerous segment rather than silently traversing it', () => {
  const obj = {};
  assert.throws(() => getPath(obj, '__proto__.polluted'), /unsafe path segment/);
});

test('a key merely containing the word prototype (not equal to it) is unaffected', () => {
  const obj = {};
  setPath(obj, 'prototypeName', 'ok');
  assert.equal(getPath(obj, 'prototypeName'), 'ok');
});
