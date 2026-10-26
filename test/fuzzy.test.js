'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fuzzyMatch, fuzzySort } = require('../src/shared/fuzzy');

test('fuzzyMatch finds the characters in order, ignoring case and accents', () => {
  assert.deepEqual(fuzzyMatch('dfe', 'Deploy Front_End').ranges, [[0, 1], [7, 8], [13, 14]]);
  assert.ok(fuzzyMatch('acao', 'Ação e reação'));
  assert.equal(fuzzyMatch('xyz', 'Deploy'), null);
  assert.equal(fuzzyMatch('ab', 'ba'), null);
  assert.deepEqual(fuzzyMatch('', 'qualquer'), { score: 0, ranges: [] });
});

test('fuzzyMatch prefers word starts and consecutive runs', () => {
  const contiguous = fuzzyMatch('front', 'Deploy Front_End');
  assert.deepEqual(contiguous.ranges, [[7, 12]]);
  assert.ok(fuzzyMatch('dep', 'Deploy').score > fuzzyMatch('dep', 'Independente').score);
  assert.ok(fuzzyMatch('nn', 'nova nota').score > fuzzyMatch('nn', 'annex').score);
});

test('fuzzyMatch treats words separated by spaces as separate terms', () => {
  assert.ok(fuzzyMatch('front dep', 'Deploy Front_End'));
  assert.equal(fuzzyMatch('front zzz', 'Deploy Front_End'), null);
});

test('fuzzySort ranks by score, then shorter, then alphabetical', () => {
  const items = ['Independente', 'Deploy Back_End', 'Deploy', 'Outra'];
  assert.deepEqual(fuzzySort('dep', items, (s) => s).map((r) => r.item), ['Deploy', 'Deploy Back_End', 'Independente']);
});
