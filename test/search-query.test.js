'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery } = require('../src/shared/search-query');
const { searchVault } = require('../src/shared/backlinks-search');

test('parseQuery splits terms, phrases, negations, operators and OR groups', () => {
  assert.deepEqual(parseQuery('deploy "front end" -velho tag:#proj path:pasta/sub file:nota /a+b/i OR outra'), [
    [
      { kind: 'text', value: 'deploy', negate: false },
      { kind: 'text', value: 'front end', negate: false },
      { kind: 'text', value: 'velho', negate: true },
      { kind: 'tag', value: 'proj', negate: false },
      { kind: 'path', value: 'pasta/sub', negate: false },
      { kind: 'file', value: 'nota', negate: false },
      { kind: 'regex', value: 'a+b', flags: 'i', negate: false },
    ],
    [{ kind: 'text', value: 'outra', negate: false }],
  ]);
  assert.deepEqual(parseQuery('tag:x -tag:y'), [[{ kind: 'tag', value: 'x', negate: false }, { kind: 'tag', value: 'y', negate: true }]]);
  assert.deepEqual(parseQuery('path:"com espaço"'), [[{ kind: 'path', value: 'com espaço', negate: false }]]);
  assert.deepEqual(parseQuery('   '), []);
});

const texts = new Map([
  ['projetos/Deploy Front.md', 'linha um\nfront end novo #proj\nvelho'],
  ['projetos/Deploy Back.md', 'back end\n#proj/sub'],
  ['diario/2026-10-26.md', 'hoje fiz deploy\n'],
  ['Outra.md', 'nada'],
]);
const tagsOf = (p) => ({ 'projetos/Deploy Front.md': ['proj'], 'projetos/Deploy Back.md': ['proj/sub'] }[p] ?? []);
const paths = (q, opts = {}) => searchVault(texts, q, { tagsOf, ...opts }).map((r) => r.path).sort();

test('searchVault: words are ANDed, any order, name or text', () => {
  assert.deepEqual(paths('deploy end'), ['projetos/Deploy Back.md', 'projetos/Deploy Front.md']);
  assert.deepEqual(paths('end deploy -velho'), ['projetos/Deploy Back.md']);
  assert.deepEqual(paths('"front end"'), ['projetos/Deploy Front.md']);
  assert.deepEqual(paths('"end front"'), []);
});

test('searchVault: tag:, path:, file:, regex and OR', () => {
  assert.deepEqual(paths('tag:#proj'), ['projetos/Deploy Back.md', 'projetos/Deploy Front.md']);
  assert.deepEqual(paths('tag:proj/sub'), ['projetos/Deploy Back.md']);
  assert.deepEqual(paths('path:diario'), ['diario/2026-10-26.md']);
  assert.deepEqual(paths('file:outra'), ['Outra.md']);
  assert.deepEqual(paths('/l.nha/'), ['projetos/Deploy Front.md']);
  assert.deepEqual(paths('nada OR hoje'), ['Outra.md', 'diario/2026-10-26.md']);
  assert.deepEqual(paths('-path:projetos deploy'), ['diario/2026-10-26.md']);
  assert.deepEqual(paths('/[/'), []);
});

test('searchVault: match case and highlighted ranges', () => {
  assert.deepEqual(paths('FRONT', { caseSensitive: true }), []);
  assert.deepEqual(paths('Front', { caseSensitive: true }), ['projetos/Deploy Front.md']);
  const [front] = searchVault(texts, 'front novo', { tagsOf });
  assert.deepEqual(front.matches, [{ line: 1, text: 'front end novo #proj', from: 0, to: 5 }]);
  const [tagHit] = searchVault(texts, 'tag:proj path:Back', { tagsOf });
  assert.equal(tagHit.total, 0);
});

test('a path like /usr/bin is text, not a regex', () => {
  assert.deepEqual(parseQuery('/usr/bin'), [[{ kind: 'text', value: '/usr/bin', negate: false }]]);
  assert.deepEqual(parseQuery('/a.b/i x'), [[{ kind: 'regex', value: 'a.b', flags: 'i', negate: false }, { kind: 'text', value: 'x', negate: false }]]);
});
