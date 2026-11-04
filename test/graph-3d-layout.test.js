'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { placeNewNodes } = require('../src/shared/graph-model');
const { rememberLayout, recallLayout } = require('../src/shared/graph-memory');

test('placeNewNodes in 3D: known depth kept, new nodes near their neighbours, spread in depth', () => {
  const known = new Map([['A', { x: 100, y: 100, z: -50 }], ['B', { x: 300, y: 100, z: 50 }]]);
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  const links = [{ source: 'C', target: 'A' }, { source: 'C', target: 'B' }];
  const out = placeNewNodes(nodes, links, known, () => 0.5, 3);
  assert.deepEqual(out[0], { id: 'A', x: 100, y: 100, z: -50 });
  assert.ok(Math.abs(out[2].z) < 20, 'between its neighbours');
  assert.ok([out[3].x, out[3].y, out[3].z].every(Number.isFinite));
  // A flat position coming into 3D gets a depth, so the layout opens up instead of staying a sheet.
  const flat = placeNewNodes([{ id: 'A' }, { id: 'B' }], [], new Map([['A', { x: 1, y: 2 }], ['B', { x: 3, y: 4 }]]), Math.random, 3);
  assert.ok(flat.every((p) => Number.isFinite(p.z)));
  assert.notEqual(flat[0].z, flat[1].z);
  // 2D stays as it was: no z.
  assert.equal('z' in placeNewNodes([{ id: 'A' }], [], new Map())[0], false);
});

test('3D layout memory: depth and the orbit camera come back', () => {
  const ids = ['a.md', 'b.md'];
  const positions = Float32Array.from([1, 2, 3, 4.04, 5, -6.06]);
  const cam = { tx: 1, ty: 2, tz: 3, distance: 400, yaw: 0.5, pitch: -0.2 };
  const memory = rememberLayout({}, '', { ids, positions, pinned: new Set(['b.md']), cam, dims: 3 }, 1);
  const back = recallLayout(JSON.parse(JSON.stringify(memory)), '');
  assert.deepEqual(back.nodes.get('a.md'), { x: 1, y: 2, z: 3, pinned: false });
  assert.deepEqual(back.nodes.get('b.md'), { x: 4, y: 5, z: -6.1, pinned: true });
  assert.deepEqual(back.cam, cam);
  // A broken camera is dropped, the nodes stay.
  const bad = rememberLayout({}, '', { ids, positions, pinned: new Set(), cam: { ...cam, distance: -1 }, dims: 3 }, 1);
  assert.equal(recallLayout(bad, '').cam, null);
  assert.equal(recallLayout(bad, '').nodes.size, 2);
});
