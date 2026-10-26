'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLinks, resolveLink, LinkIndex } = require('../src/shared/links');

// ---------- parseLinks ----------

test('parses plain, aliased, heading and embed links', () => {
  const links = parseLinks('Veja [[Deploy Front_End]], [[Deploy Back_End|back]], [[Guia#Passo 2]] e ![[Terminus SFTP.png]].');
  assert.deepEqual(
    links.map(({ target, subpath, alias, embed }) => ({ target, subpath, alias, embed })),
    [
      { target: 'Deploy Front_End', subpath: null, alias: null, embed: false },
      { target: 'Deploy Back_End', subpath: null, alias: 'back', embed: false },
      { target: 'Guia', subpath: 'Passo 2', alias: null, embed: false },
      { target: 'Terminus SFTP.png', subpath: null, alias: null, embed: true },
    ],
  );
});

test('reports the source range of each link', () => {
  const text = 'a [[b]] c';
  const [link] = parseLinks(text);
  assert.equal(text.slice(link.from, link.to), '[[b]]');
});

test('ignores links inside fenced and inline code', () => {
  const text = 'antes [[A]]\n```\n[[B]]\n```\n`[[C]]` depois [[D]]';
  assert.deepEqual(parseLinks(text).map((l) => l.target), ['A', 'D']);
});

test('ignores empty targets and trims whitespace', () => {
  assert.deepEqual(parseLinks('[[ ]] [[  Nota  ]]').map((l) => l.target), ['Nota']);
});

test('a heading-only link points to the current note', () => {
  const [link] = parseLinks('[[#Seção]]');
  assert.equal(link.target, '');
  assert.equal(link.subpath, 'Seção');
});

// ---------- resolveLink ----------

const FILES = [
  'Deploy/Deploy Front_End.md',
  'Deploy/Deploy Back_End.md',
  'Deploy/Terminus SFTP.png',
  'Reuniões/Notas.md',
  'Arquivo/Notas.md',
  'Notas.md',
  'BSA Tech Documentações.md',
];

test('resolves by note name in any folder, case-insensitive', () => {
  assert.equal(resolveLink('deploy front_end', FILES), 'Deploy/Deploy Front_End.md');
});

test('resolves attachments by file name with extension', () => {
  assert.equal(resolveLink('Terminus SFTP.png', FILES), 'Deploy/Terminus SFTP.png');
});

test('resolves an explicit path', () => {
  assert.equal(resolveLink('Reuniões/Notas', FILES), 'Reuniões/Notas.md');
  assert.equal(resolveLink('Arquivo/Notas.md', FILES), 'Arquivo/Notas.md');
});

test('with duplicate names, prefers the source folder, then the shortest path', () => {
  assert.equal(resolveLink('Notas', FILES, 'Reuniões/Ata.md'), 'Reuniões/Notas.md');
  assert.equal(resolveLink('Notas', FILES, 'Deploy/Deploy Back_End.md'), 'Notas.md');
});

test('returns null for missing notes', () => {
  assert.equal(resolveLink('Não existe', FILES), null);
});

test('heading-only link resolves to the source note', () => {
  assert.equal(resolveLink('', FILES, 'Notas.md'), 'Notas.md');
});

// ---------- LinkIndex ----------

function sampleIndex() {
  const index = new LinkIndex();
  index.setFiles([
    'Deploy Ambiente Geral.md',
    'Deploy Front_End.md',
    'Deploy Front_manual.md',
    'Deploy Back_End.md',
    'Terminus SFTP.png',
    'passando arquivos para o sftp.png',
    'Solta.md',
  ]);
  index.update('Deploy Ambiente Geral.md', '[[Deploy Front_End]] [[Deploy Back_End]] [[Fantasma]]');
  index.update('Deploy Front_End.md', '[[Deploy Front_manual]]');
  index.update('Deploy Front_manual.md', '![[Terminus SFTP.png]] ![[passando arquivos para o sftp.png]]');
  index.update('Deploy Back_End.md', 'volta para [[Deploy Ambiente Geral]]');
  index.update('Solta.md', 'sem links');
  return index;
}

test('backlinks list notes that point to a file', () => {
  const index = sampleIndex();
  assert.deepEqual(index.backlinks('Deploy Front_End.md'), ['Deploy Ambiente Geral.md']);
  assert.deepEqual(index.backlinks('Terminus SFTP.png'), ['Deploy Front_manual.md']);
  assert.deepEqual(index.backlinks('Solta.md'), []);
});

test('graph has a node per file, typed note/attachment, and resolved edges', () => {
  const { nodes, edges } = sampleIndex().graph();
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n.type]));
  assert.equal(byId['Deploy Front_End.md'], 'note');
  assert.equal(byId['Terminus SFTP.png'], 'attachment');
  assert.equal(byId['Solta.md'], 'note');
  assert.equal(byId.Fantasma, undefined);
  assert.ok(edges.some((e) => e.source === 'Deploy Front_manual.md' && e.target === 'Terminus SFTP.png'));
  assert.equal(edges.length, 5);
});

test('mutual links produce a single undirected edge', () => {
  const { edges } = sampleIndex().graph();
  const between = edges.filter((e) => [e.source, e.target].sort().join('|') === 'Deploy Ambiente Geral.md|Deploy Back_End.md');
  assert.equal(between.length, 1);
});

test('graph can include unresolved links as their own nodes', () => {
  const { nodes, edges } = sampleIndex().graph({ includeUnresolved: true });
  assert.ok(nodes.some((n) => n.id === 'Fantasma' && n.type === 'unresolved'));
  assert.ok(edges.some((e) => e.target === 'Fantasma'));
});

test('local graph keeps the note and its direct neighbours only', () => {
  const { nodes } = sampleIndex().localGraph('Deploy Front_End.md');
  assert.deepEqual(nodes.map((n) => n.id).sort(), ['Deploy Ambiente Geral.md', 'Deploy Front_End.md', 'Deploy Front_manual.md']);
});

test('updating a note replaces its old links', () => {
  const index = sampleIndex();
  index.update('Deploy Front_End.md', 'sem links agora');
  assert.deepEqual(index.backlinks('Deploy Front_manual.md'), []);
});

test('removing a file drops its links and its node', () => {
  const index = sampleIndex();
  index.remove('Deploy Back_End.md');
  assert.deepEqual(index.backlinks('Deploy Ambiente Geral.md'), []);
  assert.ok(!index.graph().nodes.some((n) => n.id === 'Deploy Back_End.md'));
});

test('links resolve again when the target file appears later', () => {
  const index = sampleIndex();
  index.setFiles([...index.files, 'Fantasma.md']);
  assert.deepEqual(index.backlinks('Fantasma.md'), ['Deploy Ambiente Geral.md']);
});

test('unresolvedTargets lists names to offer as new notes', () => {
  assert.deepEqual(sampleIndex().unresolvedTargets(), ['Fantasma']);
});

// ---------- regressões da revisão ECC ----------

test('ignores links inside multi-backtick inline code', () => {
  assert.deepEqual(parseLinks('``[[A]]`` e `` `x` [[B]] `` fora [[C]]').map((l) => l.target), ['C']);
});

test('ignores links inside inline code spanning lines of one paragraph', () => {
  assert.deepEqual(parseLinks('`a\n[[A]]\nb` [[B]]').map((l) => l.target), ['B']);
});

test('an unmatched backtick does not hide later links', () => {
  assert.deepEqual(parseLinks('preço `5 [[A]]\n\n[[B]]').map((l) => l.target), ['A', 'B']);
});

test('a fence line with an info string does not close the block', () => {
  assert.deepEqual(parseLinks('```js\n[[A]]\n```js\n[[B]]\n```\n[[C]]').map((l) => l.target), ['C']);
});

test('a longer fence is only closed by a fence at least as long', () => {
  assert.deepEqual(parseLinks('````\n```\n[[A]]\n````\n[[B]]').map((l) => l.target), ['B']);
});

test('escaped pipe inside a table separates the alias', () => {
  const [link] = parseLinks('| [[Nota\\|apelido]] |');
  assert.equal(link.target, 'Nota');
  assert.equal(link.alias, 'apelido');
});

test('resolves ./ and ../ relative to the source note', () => {
  const files = ['a/x.md', 'a/b/y.md'];
  assert.equal(resolveLink('./y', files, 'a/b/q.md'), 'a/b/y.md');
  assert.equal(resolveLink('../x', files, 'a/b/q.md'), 'a/x.md');
  assert.equal(resolveLink('./x.md', files, 'a/q.md'), 'a/x.md');
  assert.equal(resolveLink('../../fora', files, 'a/q.md'), null);
});

test('resolves a partial folder path anywhere in the vault', () => {
  assert.equal(resolveLink('Deploy/Deploy Back_End', FILES), 'Deploy/Deploy Back_End.md');
  assert.equal(resolveLink('deploy/terminus sftp.png', FILES), 'Deploy/Terminus SFTP.png');
});

test('local graph with depth 2 reaches neighbours of neighbours once', () => {
  const { nodes } = sampleIndex().localGraph('Deploy Front_End.md', { depth: 2 });
  const ids = nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('Terminus SFTP.png'));
  assert.ok(ids.includes('Deploy Back_End.md'));
});

test('editing one note stays fast with 2000 notes full of path links', () => {
  const files = [];
  for (let i = 0; i < 2000; i++) files.push(`pasta${i % 40}/Nota ${i}.md`);
  const index = new LinkIndex();
  index.setFiles(files);
  for (let i = 0; i < 2000; i++) {
    const links = Array.from({ length: 20 }, (_, k) => (k % 2 ? `[[pasta${k}/inexistente ${k}]]` : `[[pasta${k}/Nota ${(i + k) % 2000}]]`));
    index.update(files[i], links.join(' '));
  }
  index.backlinks(files[0]);
  const start = performance.now();
  index.update(files[1], '[[pasta3/Nota 3]]');
  index.backlinks(files[3]);
  index.graph();
  index.localGraph(files[3]);
  assert.ok(performance.now() - start < 300, `levou ${Math.round(performance.now() - start)} ms`);
});

test('setFiles with the same files keeps resolved links cached', () => {
  const index = new LinkIndex();
  index.setFiles(['A.md', 'B.md']);
  index.update('A.md', '[[B]]');
  const before = index.resolved();
  const cached = before.get('A.md');
  index.setFiles(['B.md', 'A.md']);
  assert.equal(index.resolved().get('A.md'), cached);
  index.setFiles(['A.md', 'B.md', 'C.md']);
  assert.notEqual(index.resolved().get('A.md'), cached);
});
