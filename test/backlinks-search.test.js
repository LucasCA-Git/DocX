'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LinkIndex } = require('../src/shared/links');
const { backlinksFor, searchVault, foldText } = require('../src/shared/backlinks-search');

function setup() {
  const texts = new Map([
    ['A.md', 'intro\nveja [[B]] aqui\n\noutra [[B|bê]] e [[C]]'],
    ['Pasta/C.md', 'só [[B#Seção]]'],
    ['B.md', 'eu mesma [[B]]'],
    ['D.md', 'sem links para B'],
  ]);
  const index = new LinkIndex();
  index.setFiles([...texts.keys()]);
  for (const [rel, text] of texts) index.update(rel, text);
  return { index, texts };
}

test('backlinksFor lists each linking note with the lines that link', () => {
  const { index, texts } = setup();
  assert.deepEqual(backlinksFor(index, 'B.md', (rel) => texts.get(rel)), [
    { source: 'A.md', lines: [{ line: 1, text: 'veja [[B]] aqui' }, { line: 3, text: 'outra [[B|bê]] e [[C]]' }] },
    { source: 'Pasta/C.md', lines: [{ line: 0, text: 'só [[B#Seção]]' }] },
  ]);
  assert.deepEqual(backlinksFor(index, 'D.md', (rel) => texts.get(rel)), []);
});

test('backlinksFor still lists a source whose text is not loaded, without lines', () => {
  const { index } = setup();
  assert.deepEqual(backlinksFor(index, 'B.md', () => undefined).map((b) => [b.source, b.lines]), [['A.md', []], ['Pasta/C.md', []]]);
});

test('foldText removes case and accents without changing length', () => {
  assert.equal(foldText('Ação É'), 'acao e');
  assert.equal(foldText('Çé').length, 2);
});

test('searchVault finds lines ignoring case and accents, with match offsets', () => {
  const texts = new Map([
    ['Deploy.md', 'Fazer o DEPLOY\nnada\nrevisar deploy de novo'],
    ['Notas/Ação.md', 'reunião sobre acao'],
    ['Outra.md', 'sem nada'],
  ]);
  const results = searchVault(texts, 'deploy');
  assert.deepEqual(results, [
    { path: 'Deploy.md', nameMatch: true, total: 2, matches: [{ line: 0, text: 'Fazer o DEPLOY', from: 8, to: 14 }, { line: 2, text: 'revisar deploy de novo', from: 8, to: 14 }] },
  ]);
  const accent = searchVault(texts, 'ação');
  assert.deepEqual(accent.map((r) => [r.path, r.nameMatch, r.matches.length]), [['Notas/Ação.md', true, 1]]);
  assert.deepEqual(searchVault(texts, '  '), []);
});

test('searchVault caps matches per file and files in total', () => {
  const texts = new Map(Array.from({ length: 5 }, (_, i) => [`n${i}.md`, 'x\nx\nx\nx']));
  const results = searchVault(texts, 'x', { maxFiles: 3, maxMatchesPerFile: 2 });
  assert.equal(results.length, 3);
  assert.equal(results[0].matches.length, 2);
  assert.equal(results[0].total, 4);
});

test('CRLF notes: lines are counted once per break and come back without \\r', () => {
  const texts = new Map([['W.md', 'um\r\ndois deploy\r\ntres [[B]]\r\n']]);
  assert.deepEqual(searchVault(texts, 'deploy')[0].matches, [{ line: 1, text: 'dois deploy', from: 5, to: 11 }]);
  const index = new LinkIndex();
  index.setFiles(['W.md', 'B.md']);
  index.update('W.md', texts.get('W.md'));
  assert.deepEqual(backlinksFor(index, 'B.md', (rel) => texts.get(rel))[0].lines, [{ line: 2, text: 'tres [[B]]' }]);
});

test('searchVault reuses folded text from the cache while the note is unchanged', () => {
  const cache = new Map();
  const texts = new Map([['A.md', 'Ação']]);
  assert.equal(searchVault(texts, 'acao', { cache }).length, 1);
  assert.equal(cache.get('A.md').folded, 'acao');
  cache.set('A.md', { text: 'Ação', folded: 'zzzz' });
  assert.equal(searchVault(texts, 'acao', { cache }).length, 0);
  texts.set('A.md', 'Ação nova');
  assert.equal(searchVault(texts, 'acao', { cache }).length, 1);
});

test('unlinkedMentions finds the note name as plain text, not inside links or other words', () => {
  const { LinkIndex } = require('../src/shared/links');
  const { unlinkedMentions } = require('../src/shared/backlinks-search');
  const texts = new Map([
    ['Deploy Front.md', '---\naliases: [DF]\n---\nnota alvo'],
    ['a.md', 'Fiz o deploy front ontem.\nE [[Deploy Front]] já ligado.\nDeploy Frontal não conta.'],
    ['b.md', 'Falei do DF hoje\n`Deploy Front` em código conta como texto? não'],
    ['c.md', 'nada aqui #deploy front'],
    ['d.md', '#Deploy Front'],
  ]);
  const index = new LinkIndex();
  index.setFiles([...texts.keys()]);
  for (const [rel, text] of texts) index.update(rel, text);
  const result = unlinkedMentions(index, 'Deploy Front.md', texts);
  assert.deepEqual(result, [
    { source: 'a.md', lines: [{ line: 0, text: 'Fiz o deploy front ontem.', from: 6, to: 18 }] },
    { source: 'b.md', lines: [{ line: 0, text: 'Falei do DF hoje', from: 9, to: 11 }] },
  ]);
});

test('unlinkedMentions ignores fenced code, Markdown links and URLs', () => {
  const { LinkIndex } = require('../src/shared/links');
  const { unlinkedMentions } = require('../src/shared/backlinks-search');
  const texts = new Map([
    ['Alvo.md', ''],
    ['a.md', '```\nAlvo\n```\n[Alvo](x.md) https://x.com/Alvo\nAlvo sim'],
  ]);
  const index = new LinkIndex();
  index.setFiles([...texts.keys()]);
  for (const [rel, text] of texts) index.update(rel, text);
  const cache = new Map();
  assert.deepEqual(unlinkedMentions(index, 'Alvo.md', texts, cache)[0].lines.map((l) => l.line), [4]);
  assert.equal(cache.size, 1);
});
