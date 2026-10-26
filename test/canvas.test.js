'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCanvas, serializeCanvas, sidePoint, nodesInRect, nodesInGroup, bounds, newId, closestSide,
} = require('../src/shared/canvas');

const sample = JSON.stringify({
  nodes: [
    { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '# Oi', color: '1' },
    { id: 'b', type: 'file', x: 300, y: 0, width: 200, height: 100, file: 'Notas/x.md', subpath: '#Sec' },
    { id: 'c', type: 'link', x: 0, y: 200, width: 200, height: 100, url: 'https://obsidian.md' },
    { id: 'g', type: 'group', x: -20, y: -20, width: 600, height: 160, label: 'Grupo' },
    { id: 'bad', type: 'iframe', x: 0, y: 0, width: 10, height: 10 },
    { id: 'nan', type: 'text', x: 'x', y: 0, width: 10, height: 10, text: '' },
  ],
  edges: [
    { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', toEnd: 'arrow', label: 'liga' },
    { id: 'e2', fromNode: 'a', toNode: 'sumiu' },
  ],
  extra: { keep: true },
});

test('parseCanvas keeps valid nodes/edges and unknown top-level fields, drops broken ones', () => {
  const c = parseCanvas(sample);
  assert.deepEqual(c.nodes.map((n) => n.id), ['a', 'b', 'c', 'g']);
  assert.deepEqual(c.edges.map((e) => e.id), ['e1']);
  assert.deepEqual(c.extra, { keep: true });
  assert.deepEqual(parseCanvas(''), { nodes: [], edges: [] });
  assert.deepEqual(parseCanvas('{lixo'), { nodes: [], edges: [] });
});

test('serializeCanvas writes groups first (drawn behind) as tab-indented JSON', () => {
  const text = serializeCanvas(parseCanvas(sample));
  const back = JSON.parse(text);
  assert.equal(back.nodes[0].id, 'g');
  assert.ok(text.includes('\n\t'));
});

test('geometry helpers', () => {
  const n = { x: 0, y: 0, width: 200, height: 100 };
  assert.deepEqual(sidePoint(n, 'right'), { x: 200, y: 50 });
  assert.deepEqual(sidePoint(n, 'top'), { x: 100, y: 0 });
  assert.equal(closestSide(n, { x: 500, y: 60 }), 'right');
  assert.equal(closestSide(n, { x: 100, y: -300 }), 'top');
  const c = parseCanvas(sample);
  assert.deepEqual(nodesInRect(c.nodes, { x: -10, y: -10, width: 230, height: 130 }).map((x) => x.id), ['a']);
  assert.deepEqual(nodesInGroup(c.nodes, c.nodes.find((x) => x.id === 'g')).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(bounds(c.nodes), { x: -20, y: -20, width: 600, height: 320 });
  assert.match(newId(), /^[0-9a-f]{16}$/);
});

test('renameInCanvas updates file cards that point into a renamed path', () => {
  const { renameInCanvas } = require('../src/shared/canvas');
  const map = (p) => (p === 'a.md' ? 'b.md' : p.startsWith('pasta/') ? `nova/${p.slice(6)}` : p);
  const text = serializeCanvas(parseCanvas(JSON.stringify({ nodes: [
    { id: '1', type: 'file', file: 'a.md', x: 0, y: 0, width: 10, height: 10 },
    { id: '2', type: 'file', file: 'pasta/x.png', x: 0, y: 0, width: 10, height: 10 },
    { id: '3', type: 'text', text: 'a.md', x: 0, y: 0, width: 10, height: 10 },
  ] })));
  const out = JSON.parse(renameInCanvas(text, map));
  assert.deepEqual(out.nodes.map((n) => n.file ?? n.text), ['b.md', 'nova/x.png', 'a.md']);
  assert.equal(renameInCanvas(text, (p) => p), null);
});
