'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LinkIndex } = require('../src/shared/links');
const {
  graphData, nodeRadius, zoomAt, toWorld, toScreen, hitTest, placeNewNodes, MIN_ZOOM, MAX_ZOOM,
} = require('../src/shared/graph-model');

function vault() {
  const index = new LinkIndex();
  index.setFiles(['Deploy/Front_manual.md', 'Deploy/Front_End.md', 'Sozinha.md', 'img/a.png', 'img/b.png', 'img/solta.png']);
  index.update('Deploy/Front_manual.md', '[[Front_End]] ![[a.png]] ![[b.png]] [[Fantasma]]');
  index.update('Deploy/Front_End.md', '[[Front_manual]]');
  index.update('Sozinha.md', 'nada');
  return index;
}

const ids = (data) => data.nodes.map((n) => n.id).sort();
const edges = (data) => data.links.map((l) => [l.source, l.target].sort().join('->')).sort();

test('graphData lists notes and attachments with labels, types and degrees', () => {
  const data = graphData(vault());
  assert.deepEqual(ids(data), ['Deploy/Front_End.md', 'Deploy/Front_manual.md', 'Sozinha.md', 'img/a.png', 'img/b.png', 'img/solta.png']);
  const manual = data.nodes.find((n) => n.id === 'Deploy/Front_manual.md');
  assert.deepEqual(manual, { id: 'Deploy/Front_manual.md', type: 'note', label: 'Front_manual', degree: 3 });
  assert.deepEqual(data.nodes.find((n) => n.id === 'img/a.png'), { id: 'img/a.png', type: 'attachment', label: 'a.png', degree: 1 });
  assert.equal(data.links.length, 3);
});

test('graphData filters: attachments, unresolved, orphans, search', () => {
  assert.deepEqual(ids(graphData(vault(), { attachments: false })), ['Deploy/Front_End.md', 'Deploy/Front_manual.md', 'Sozinha.md']);
  assert.equal(graphData(vault(), { attachments: false }).nodes.find((n) => n.id === 'Deploy/Front_manual.md').degree, 1);
  assert.ok(ids(graphData(vault(), { unresolved: true })).includes('Fantasma'));
  assert.deepEqual(ids(graphData(vault(), { orphans: false })), ['Deploy/Front_End.md', 'Deploy/Front_manual.md', 'img/a.png', 'img/b.png']);
  const found = graphData(vault(), { search: 'deploy' });
  assert.deepEqual(ids(found), ['Deploy/Front_End.md', 'Deploy/Front_manual.md']);
  assert.deepEqual(edges(found), ['Deploy/Front_End.md->Deploy/Front_manual.md']);
});

test('nodeRadius grows with links but stays bounded', () => {
  assert.ok(nodeRadius(0) >= 3);
  assert.ok(nodeRadius(10) > nodeRadius(1));
  assert.ok(nodeRadius(10000) <= 24);
});

test('zoomAt keeps the point under the cursor fixed and clamps the scale', () => {
  const cam = { x: 100, y: 50, k: 1 };
  const before = toWorld(cam, 300, 200);
  const next = zoomAt(cam, 2, 300, 200);
  assert.equal(next.k, 2);
  assert.deepEqual(toWorld(next, 300, 200), before);
  assert.deepEqual(toScreen(next, before.x, before.y), { x: 300, y: 200 });
  assert.equal(zoomAt(cam, 1000, 0, 0).k, MAX_ZOOM);
  assert.equal(zoomAt(cam, 0.00001, 0, 0).k, MIN_ZOOM);
});

test('hitTest finds the nearest node under the pointer, with a minimum target size', () => {
  const nodes = [{ degree: 0 }, { degree: 0 }];
  const pos = new Float32Array([0, 0, 50, 0]);
  assert.equal(hitTest(nodes, pos, 1, 1, 1), 0);
  assert.equal(hitTest(nodes, pos, 48, 2, 1), 1);
  assert.equal(hitTest(nodes, pos, 25, 0, 1), -1);
  // Zoomed far out, nodes are tiny on screen but still clickable within a few pixels.
  assert.equal(hitTest(nodes, pos, 12, 0, 1), -1);
  assert.equal(hitTest(nodes, pos, 12, 0, 0.1), 0);
});

test('placeNewNodes keeps known positions and puts new nodes near their neighbours', () => {
  const known = new Map([['A', { x: 100, y: 100 }], ['B', { x: 300, y: 100 }]]);
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  const links = [{ source: 'C', target: 'A' }, { source: 'C', target: 'B' }];
  const out = placeNewNodes(nodes, links, known, () => 0.5);
  assert.deepEqual(out[0], { id: 'A', x: 100, y: 100 });
  assert.deepEqual(out[1], { id: 'B', x: 300, y: 100 });
  assert.ok(Math.abs(out[2].x - 200) < 20 && Math.abs(out[2].y - 100) < 20);
  assert.ok(Number.isFinite(out[3].x) && Number.isFinite(out[3].y));
});

test('graphData with a center keeps the note and its neighbours up to the depth', () => {
  const index = vault();
  const local = graphData(index, { center: 'Deploy/Front_End.md' });
  assert.deepEqual(ids(local), ['Deploy/Front_End.md', 'Deploy/Front_manual.md']);
  const deeper = graphData(index, { center: 'Deploy/Front_End.md', depth: 2 });
  assert.deepEqual(ids(deeper), ['Deploy/Front_End.md', 'Deploy/Front_manual.md', 'img/a.png', 'img/b.png']);
  assert.deepEqual(ids(graphData(index, { center: 'Sozinha.md', orphans: false })), ['Sozinha.md']);
  assert.deepEqual(ids(graphData(index, { center: 'Nada.md' })), []);
});

function tagged() {
  const index = vault();
  index.update('Sozinha.md', '#ideia #projeto/web');
  index.update('Deploy/Front_End.md', '[[Front_manual]] #projeto/web');
  return index;
}

test('graphData: tags as nodes linked to their notes', () => {
  const data = graphData(tagged(), { tags: true, attachments: false });
  assert.deepEqual(ids(data).filter((id) => id.startsWith('#')), ['#ideia', '#projeto/web']);
  const tag = data.nodes.find((n) => n.id === '#projeto/web');
  assert.deepEqual(tag, { id: '#projeto/web', type: 'tag', label: '#projeto/web', degree: 2 });
  assert.ok(edges(data).includes('#projeto/web->Sozinha.md'));
  assert.ok(!ids(graphData(tagged())).some((id) => id.startsWith('#')));
});

test('graphData: the filter understands the search syntax', () => {
  assert.deepEqual(ids(graphData(tagged(), { search: 'tag:#projeto', attachments: false })), ['Deploy/Front_End.md', 'Sozinha.md']);
  assert.deepEqual(ids(graphData(tagged(), { search: 'deploy -manual' })), ['Deploy/Front_End.md']);
  assert.deepEqual(ids(graphData(tagged(), { search: 'path:img OR sozinha' })), ['Sozinha.md', 'img/a.png', 'img/b.png', 'img/solta.png']);
});

test('graphData: color groups, first matching group wins', () => {
  const data = graphData(tagged(), { groups: [{ query: 'tag:#projeto', color: '#ff0000' }, { query: 'path:Deploy', color: '#00ff00' }] });
  const group = (id) => data.nodes.find((n) => n.id === id).group;
  assert.equal(group('Sozinha.md'), 0);
  assert.equal(group('Deploy/Front_End.md'), 0);
  assert.equal(group('Deploy/Front_manual.md'), 1);
  assert.equal(group('img/a.png'), -1);
});
