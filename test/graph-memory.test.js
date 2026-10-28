'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { rememberLayout, recallLayout, MAX_FOLDERS } = require('../src/shared/graph-memory');

const layout = (ids, pinned = []) => ({
  ids,
  positions: Float32Array.from(ids.flatMap((_, i) => [i * 10.04, -i * 5.06])),
  pinned: new Set(pinned),
  cam: { x: 1, y: 2, k: 0.5 },
});

test('a folder layout comes back as it was left: positions, pins and camera', () => {
  const memory = rememberLayout({}, 'Projetos', layout(['a.md', 'b.md', 'c.md'], ['b.md']), 1000);
  const back = recallLayout(memory, 'Projetos');
  assert.deepEqual(back.cam, { x: 1, y: 2, k: 0.5 });
  assert.deepEqual(back.nodes.get('b.md'), { x: 10, y: -5.1, pinned: true });
  assert.deepEqual(back.nodes.get('a.md'), { x: 0, y: 0, pinned: false });
  assert.equal(recallLayout(memory, 'Outra'), null);
  // Survives a JSON round trip (it lives in localStorage).
  assert.deepEqual(recallLayout(JSON.parse(JSON.stringify(memory)), 'Projetos').nodes.get('b.md'), { x: 10, y: -5.1, pinned: true });
});

test('each folder is kept apart; the oldest are forgotten past the limit', () => {
  let memory = {};
  for (let i = 0; i < MAX_FOLDERS + 3; i++) memory = rememberLayout(memory, `p${i}`, layout(['x.md']), i);
  assert.equal(Object.keys(memory.folders).length, MAX_FOLDERS);
  assert.equal(recallLayout(memory, 'p0'), null);
  assert.ok(recallLayout(memory, `p${MAX_FOLDERS + 2}`));
});

test('broken or foreign data is ignored', () => {
  assert.equal(recallLayout(null, ''), null);
  assert.equal(recallLayout({ folders: { '': { nodes: 'x' } } }, ''), null);
  const odd = recallLayout({ folders: { '': { cam: { x: 'a' }, nodes: { 'a.md': [1, 2, 1], 'b.md': ['x', 2] } } } }, '');
  assert.equal(odd.cam, null);
  assert.deepEqual([...odd.nodes.keys()], ['a.md']);
});
