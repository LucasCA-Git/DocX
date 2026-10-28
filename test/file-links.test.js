'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { boardLinks } = require('../src/shared/file-links');
const { LinkIndex, isBoard } = require('../src/shared/links');

const targets = (links) => links.map((l) => (l.subpath ? `${l.target}#${l.subpath}` : l.target));

test('isBoard: canvas, drawings and diagrams', () => {
  assert.ok(isBoard('a/Mapa.canvas'));
  assert.ok(isBoard('Desenho.excalidraw'));
  assert.ok(isBoard('Fluxo.drawio.svg'));
  assert.ok(isBoard('Fluxo.drawio'));
  assert.ok(!isBoard('Nota.md'));
  assert.ok(!isBoard('foto.svg'));
});

test('canvas: file cards and [[links]] in text cards', () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: '1', type: 'file', file: 'pasta/Nota.md', x: 0, y: 0, width: 100, height: 100 },
      { id: '2', type: 'file', file: 'Guia.md', subpath: '#Passo 2', x: 0, y: 0, width: 100, height: 100 },
      { id: '3', type: 'text', text: 'Ver [[Deploy]] e [[Outra|apelido]]', x: 0, y: 0, width: 100, height: 100 },
      { id: '4', type: 'link', url: 'https://example.com', x: 0, y: 0, width: 100, height: 100 },
    ],
    edges: [],
  });
  assert.deepEqual(targets(boardLinks('Mapa.canvas', canvas)), ['pasta/Nota.md', 'Guia.md#Passo 2', 'Deploy', 'Outra']);
});

test('excalidraw: element links and [[links]] written in text, deleted elements ignored', () => {
  const scene = JSON.stringify({
    type: 'excalidraw',
    elements: [
      { id: 'a', type: 'rectangle', link: '[[Nota A]]' },
      { id: 'b', type: 'text', text: 'leia [[Nota B]]', link: null },
      { id: 'c', type: 'rectangle', link: 'https://example.com' },
      { id: 'd', type: 'rectangle', link: '[[Apagada]]', isDeleted: true },
    ],
  });
  assert.deepEqual(targets(boardLinks('D.excalidraw', scene)), ['Nota A', 'Nota B']);
});

test('drawio: link attributes and labels, in .drawio and .drawio.svg', () => {
  const xml = '<mxfile><diagram id="x"><mxGraphModel><root>'
    + '<mxCell id="2" value="&lt;b&gt;[[Nota A]]&lt;/b&gt;" vertex="1"/>'
    + '<UserObject label="Caixa" link="[[Nota B]]" id="3"><mxCell vertex="1"/></UserObject>'
    + '<UserObject label="site" link="https://example.com" id="4"><mxCell vertex="1"/></UserObject>'
    + '</root></mxGraphModel></diagram></mxfile>';
  assert.deepEqual(targets(boardLinks('F.drawio', xml)), ['Nota A', 'Nota B']);
  const escaped = xml.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${escaped}"><g/></svg>`;
  assert.deepEqual(targets(boardLinks('F.drawio.svg', svg)), ['Nota A', 'Nota B']);
});

test('broken or foreign files give no links', () => {
  assert.deepEqual(boardLinks('a.canvas', '{nope'), []);
  assert.deepEqual(boardLinks('a.excalidraw', '{"type":"outra-coisa"}'), []);
  assert.deepEqual(boardLinks('a.excalidraw', 'não é json'), []);
  assert.deepEqual(boardLinks('a.drawio.svg', '<svg></svg>'), []);
  assert.deepEqual(boardLinks('a.md', '[[x]]'), []);
});

test('index: board links count as backlinks and graph edges; boards are their own node type', () => {
  const index = new LinkIndex();
  index.setFiles(['Nota.md', 'Mapa.canvas', 'foto.png']);
  index.update('Nota.md', 'sem links');
  index.updateLinks('Mapa.canvas', boardLinks('Mapa.canvas', JSON.stringify({
    nodes: [{ id: '1', type: 'file', file: 'Nota.md', x: 0, y: 0, width: 100, height: 100 }], edges: [],
  })));
  assert.deepEqual(index.backlinks('Nota.md'), ['Mapa.canvas']);
  const { nodes, edges } = index.graph();
  assert.equal(nodes.find((n) => n.id === 'Mapa.canvas').type, 'board');
  assert.equal(nodes.find((n) => n.id === 'foto.png').type, 'attachment');
  assert.deepEqual(edges, [{ source: 'Mapa.canvas', target: 'Nota.md' }]);
  assert.equal(index.meta.has('Mapa.canvas'), false);
});
