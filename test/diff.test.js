'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diffLines } = require('../src/shared/diff');

const ops = (d) => d.map((p) => `${p.type[0]}:${p.text}`);

test('diffLines marks added, removed and unchanged lines', () => {
  const d = diffLines('a\nb\nc', 'a\nx\nc\nd');
  assert.deepEqual(ops(d), ['e:a', 'r:b', 'a:x', 'e:c', 'a:d']);
});

test('diffLines handles empty sides and CRLF', () => {
  assert.deepEqual(ops(diffLines('', 'a')), ['a:a']);
  assert.deepEqual(ops(diffLines('a\r\nb', 'a\nb')), ['e:a', 'e:b']);
  assert.deepEqual(diffLines('x', 'x').every((p) => p.type === 'equal'), true);
});

test('diffLines keeps big inputs cheap by trimming the common start and end', () => {
  const big = Array.from({ length: 50_000 }, (_, i) => `linha ${i}`);
  const changed = [...big];
  changed[25_000] = 'mudou';
  const t = Date.now();
  const d = diffLines(big.join('\n'), changed.join('\n'));
  assert.ok(Date.now() - t < 1000);
  assert.deepEqual(d.filter((p) => p.type !== 'equal').map((p) => p.text), ['linha 25000', 'mudou']);
});

test('diffLines gives up on a huge rewrite instead of hanging', () => {
  const a = Array.from({ length: 20_000 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 20_000 }, (_, i) => `b${i}`).join('\n');
  const d = diffLines(a, b);
  assert.equal(d.filter((p) => p.type === 'removed').length, 20_000);
  assert.equal(d.filter((p) => p.type === 'added').length, 20_000);
});
