'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LinkIndex } = require('../src/shared/links');
const { graphData } = require('../src/shared/graph-model');
const {
  galaxyLayout, folderSun, galaxyId, isGalaxyId, parentFolder,
} = require('../src/shared/graph-galaxy');

function vault() {
  const index = new LinkIndex();
  index.setFiles([
    'README.md', 'Ideias.md',
    'Projetos/Projetos.md', 'Projetos/Alpha.md', 'Projetos/Beta.md',
    'Projetos/Antigos/Velho.md', 'Projetos/Antigos/Mais velho.md',
    'Diario/2026-10-27.md', 'Diario/2026-10-28.md',
  ]);
  index.update('README.md', '[[Ideias]] [[Projetos]]');
  index.update('Ideias.md', '[[Alpha]] [[Beta]] [[2026-10-27]]');
  index.update('Projetos/Projetos.md', '[[Alpha]] [[Beta]] [[Velho]] [[Ideias]]');
  index.update('Projetos/Alpha.md', '[[Beta]]');
  index.update('Projetos/Beta.md', '');
  index.update('Projetos/Antigos/Velho.md', '[[Mais velho]]');
  index.update('Projetos/Antigos/Mais velho.md', '');
  index.update('Diario/2026-10-27.md', '[[2026-10-28]] [[Ideias]]');
  index.update('Diario/2026-10-28.md', '');
  return index;
}

const byId = (layout) => new Map(layout.nodes.map((n) => [n.id, n]));
const pair = (a, b) => [a, b].sort().join(' — ');
const pairs = (layout) => layout.links.map((l) => pair(l.source, l.target)).sort();

test('at the vault root: root files around the root sun, folders as galaxies', () => {
  const layout = galaxyLayout(graphData(vault()));
  const nodes = byId(layout);
  assert.deepEqual([...nodes.keys()].sort(), ['Ideias.md', 'README.md', galaxyId('Diario'), galaxyId('Projetos')].sort());
  const projetos = nodes.get(galaxyId('Projetos'));
  assert.equal(projetos.type, 'galaxy');
  assert.equal(projetos.label, 'Projetos');
  assert.equal(projetos.count, 5);
  assert.equal(projetos.folder, 'Projetos');
  assert.ok(projetos.radius > nodes.get('Ideias.md').radius);
  assert.equal(nodes.get('README.md').type, 'sun');
  assert.equal(nodes.get('README.md').anchor, null);
  assert.equal(nodes.get('Ideias.md').anchor, 'README.md');
  // Galaxies are not tied to any sun: only links bring them together.
  assert.equal(projetos.anchor, null);
  assert.equal(nodes.get(galaxyId('Diario')).anchor, null);
  // Links into a galaxy are merged into one per pair.
  assert.deepEqual(pairs(layout), [
    pair('Ideias.md', galaxyId('Diario')),
    pair('Ideias.md', galaxyId('Projetos')),
    pair('Ideias.md', 'README.md'),
    pair('README.md', galaxyId('Projetos')),
  ].sort());
  assert.ok(isGalaxyId(galaxyId('x')) && !isGalaxyId('x'));
});

test('inside a galaxy only its contents show: its sun, its docs and its subfolders', () => {
  const layout = galaxyLayout(graphData(vault()), { folder: 'Projetos' });
  const nodes = byId(layout);
  assert.deepEqual([...nodes.keys()].sort(), ['Projetos/Alpha.md', 'Projetos/Beta.md', 'Projetos/Projetos.md', galaxyId('Projetos/Antigos')].sort());
  assert.equal(nodes.get('Projetos/Projetos.md').type, 'sun');
  assert.equal(nodes.get('Projetos/Projetos.md').anchor, null);
  assert.equal(nodes.get('Projetos/Alpha.md').anchor, 'Projetos/Projetos.md');
  assert.equal(nodes.get(galaxyId('Projetos/Antigos')).anchor, null);
  assert.equal(nodes.get(galaxyId('Projetos/Antigos')).count, 2);
  // Links leaving the folder (Projetos → Ideias) are not shown.
  assert.deepEqual(pairs(layout), [
    pair('Projetos/Alpha.md', 'Projetos/Beta.md'),
    pair('Projetos/Projetos.md', 'Projetos/Alpha.md'),
    pair('Projetos/Projetos.md', 'Projetos/Beta.md'),
    pair('Projetos/Projetos.md', galaxyId('Projetos/Antigos')),
  ].sort());
});

test('a nested galaxy and an empty or missing folder', () => {
  const nodes = byId(galaxyLayout(graphData(vault()), { folder: 'Projetos/Antigos' }));
  assert.deepEqual([...nodes.keys()].sort(), ['Projetos/Antigos/Mais velho.md', 'Projetos/Antigos/Velho.md']);
  assert.equal(galaxyLayout(graphData(vault()), { folder: 'Nada' }).nodes.length, 0);
});

test('a folder with only subfolders has no sun', () => {
  const index = new LinkIndex();
  index.setFiles(['Vazia/Sub/Nota.md']);
  index.update('Vazia/Sub/Nota.md', '');
  const nodes = byId(galaxyLayout(graphData(index), { folder: 'Vazia' }));
  assert.equal(nodes.get(galaxyId('Vazia/Sub')).anchor, null);
});

test('folderSun: same name as the folder, then README/index, then the most linked note', () => {
  const n = (id, degree, type = 'note') => ({ id, degree, type });
  assert.equal(folderSun('Projetos', [n('Projetos/A.md', 9), n('Projetos/projetos.md', 0)]), 'Projetos/projetos.md');
  assert.equal(folderSun('X', [n('X/A.md', 9), n('X/index.md', 0)]), 'X/index.md');
  assert.equal(folderSun('X', [n('X/A.md', 1), n('X/B.md', 4), n('X/foto.png', 9, 'attachment')]), 'X/B.md');
  assert.equal(folderSun('X', [n('X/foto.png', 2, 'attachment')]), 'X/foto.png');
  assert.equal(folderSun('X', []), null);
});

test('tags and missing notes float free at the root and stay out of folders', () => {
  const index = vault();
  index.update('Projetos/Alpha.md', '[[Fantasma]] #tema');
  const root = byId(galaxyLayout(graphData(index, { unresolved: true, tags: true })));
  assert.equal(root.get('Fantasma').anchor, null);
  assert.equal(root.get('Fantasma').type, 'unresolved');
  assert.equal(root.get('#tema').anchor, null);
  const inside = byId(galaxyLayout(graphData(index, { unresolved: true, tags: true }), { folder: 'Projetos' }));
  assert.ok(!inside.has('Fantasma') && !inside.has('#tema'));
});

test('parentFolder walks up to the vault root', () => {
  assert.equal(parentFolder('a/b/c'), 'a/b');
  assert.equal(parentFolder('a'), '');
  assert.equal(parentFolder(''), null);
});
