'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontMatter, parseTags, parseHeadings, parseBlockIds, noteMetadata } = require('../src/shared/metadata');

test('parseFrontMatter reads scalars, lists and inline arrays', () => {
  const text = [
    '---',
    'title: "Minha nota"',
    'tags: [projeto, "deploy/front"]',
    'aliases:',
    '  - Apelido um',
    "  - 'Apelido: dois'",
    'nota: 7',
    'feito: true',
    'vazio:',
    'data: 2026-10-26',
    'url: https://exemplo.com/a#b',
    '# comentário',
    '---',
    'corpo',
  ].join('\n');
  const fm = parseFrontMatter(text);
  assert.deepEqual(fm.data, {
    title: 'Minha nota',
    tags: ['projeto', 'deploy/front'],
    aliases: ['Apelido um', 'Apelido: dois'],
    nota: 7,
    feito: true,
    vazio: null,
    data: '2026-10-26',
    url: 'https://exemplo.com/a#b',
  });
  assert.equal(text.slice(fm.to), '\ncorpo');
  assert.equal(fm.bodyLine, 13);
});

test('parseFrontMatter: only at the very top, CRLF, and absent', () => {
  assert.equal(parseFrontMatter('texto\n---\na: 1\n---').data, null);
  assert.deepEqual(parseFrontMatter('---\r\na: b\r\n---\r\nx').data, { a: 'b' });
  assert.deepEqual(parseFrontMatter('---\n---\n').data, {});
  assert.equal(parseFrontMatter('---\na: 1\nsem fim').data, null);
  assert.deepEqual(parseFrontMatter('---\ntags: um, dois\n---').data, { tags: 'um, dois' });
});

test('parseTags finds #tags outside code, links and headings', () => {
  const text = [
    '# Título não é tag',
    'Texto com #projeto e #deploy/front-end, #ação.',
    'Não: #123, a#b, `#codigo`, [[nota#seção]], https://x.com/#ancora',
    '```',
    '#dentro',
    '```',
    '#fim',
  ].join('\n');
  assert.deepEqual(parseTags(text).map((t) => t.tag), ['projeto', 'deploy/front-end', 'ação', 'fim']);
  const first = parseTags(text)[0];
  assert.equal(text.slice(first.from, first.to), '#projeto');
});

test('parseHeadings and parseBlockIds', () => {
  const text = '# Um\ntexto ^bloco-1\n## Dois ##\n```\n# não\n```\nSetext\n===\nfim ^x2';
  assert.deepEqual(parseHeadings(text), [
    { level: 1, text: 'Um', line: 0 },
    { level: 2, text: 'Dois', line: 2 },
    { level: 1, text: 'Setext', line: 6 },
  ]);
  assert.deepEqual(parseBlockIds(text), [{ id: 'bloco-1', line: 1 }, { id: 'x2', line: 8 }]);
});

test('noteMetadata merges front matter tags (with or without #) and aliases', () => {
  const meta = noteMetadata('---\ntags:\n  - "#Projeto"\n  - leitura\nalias: Único\n---\n# T\nVer #leitura e #outra');
  assert.deepEqual(meta.tags, ['Projeto', 'leitura', 'outra']);
  assert.deepEqual(meta.aliases, ['Único']);
  assert.equal(meta.headings[0].text, 'T');
  assert.deepEqual(noteMetadata('---\ntags: um dois\n---').tags, ['um', 'dois']);
  assert.deepEqual(noteMetadata('---\naliases: [A, B]\n---').aliases, ['A', 'B']);
});

test('LinkIndex keeps tags and aliases of every note', () => {
  const { LinkIndex } = require('../src/shared/links');
  const index = new LinkIndex();
  index.setFiles(['a.md', 'b.md']);
  index.update('a.md', '---\naliases: [Apelido]\ntags: proj\n---\n#Proj/sub #leitura');
  index.update('b.md', '#proj');
  assert.deepEqual(index.tagCounts(), [{ tag: 'leitura', count: 1 }, { tag: 'proj', count: 2 }, { tag: 'Proj/sub', count: 1 }]);
  assert.deepEqual(index.tagsOf('b.md'), ['proj']);
  assert.deepEqual([...index.aliases], [['a.md', ['Apelido']]]);
  index.setFiles(['b.md']);
  assert.deepEqual([...index.aliases], []);
  assert.equal(index.metadata('a.md'), null);
});

test('subpathLine finds a heading (any case, ignoring accents/marks) or a ^block id', () => {
  const { subpathLine } = require('../src/shared/metadata');
  const meta = { headings: [{ level: 1, text: 'Visão Geral', line: 0 }, { level: 2, text: 'Passo **2**', line: 4 }], blocks: [{ id: 'abc', line: 7 }] };
  assert.equal(subpathLine(meta, 'visao geral'), 0);
  assert.equal(subpathLine(meta, 'Passo 2'), 4);
  assert.equal(subpathLine(meta, 'Visão Geral#Passo 2'), 4);
  assert.equal(subpathLine(meta, '^abc'), 7);
  assert.equal(subpathLine(meta, 'nada'), null);
  assert.equal(subpathLine(null, 'x'), null);
});

test('review fixes: a leading --- rule is not front matter; empty tags; fenced code in lists', () => {
  assert.equal(parseFrontMatter('---\num parágrafo qualquer\n---\nmais').data, null);
  assert.deepEqual(parseTags('a #- b #-- c').map((t) => t.tag), []);
  assert.deepEqual(parseTags('- item\n  ```\n  #dentro\n  ```\n> ```\n> #citado\n> ```\n#fora').map((t) => t.tag), ['fora']);
});
