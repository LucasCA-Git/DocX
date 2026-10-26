'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LinkIndex } = require('../src/shared/links');
const { linkUpdatesForRename } = require('../src/shared/rename-links');

function indexOf(texts) {
  const index = new LinkIndex();
  index.setFiles(Object.keys(texts));
  for (const [rel, text] of Object.entries(texts)) if (/\.md$/.test(rel)) index.update(rel, text);
  return index;
}

test('renaming a note rewrites links, keeping heading, alias and embeds', () => {
  const texts = {
    'Velha.md': 'alvo',
    'a.md': 'Ver [[Velha]], [[Velha#Seção|apelido]] e ![[Velha]].\n[[Outra]] fica.',
    'b.md': 'sem links',
    'Outra.md': '',
  };
  const updates = linkUpdatesForRename(indexOf(texts), (p) => texts[p], 'Velha.md', 'Nova.md');
  assert.deepEqual([...updates.keys()], ['a.md']);
  assert.equal(updates.get('a.md'), 'Ver [[Nova]], [[Nova#Seção|apelido]] e ![[Nova]].\n[[Outra]] fica.');
});

test('moving to a folder keeps the shortest link that still resolves', () => {
  const texts = { 'Nota.md': '', 'x/Nota.md': '', 'a.md': '[[Nota]] e [[x/Nota]]' };
  const up = linkUpdatesForRename(indexOf(texts), (p) => texts[p], 'Nota.md', 'y/Nota.md');
  // "Nota" alone would now be ambiguous with x/Nota.md (shallower wins): the path is written.
  assert.equal(up.get('a.md'), '[[y/Nota]] e [[x/Nota]]');
});

test('renaming a folder rewrites links to every file inside it, including attachments', () => {
  const texts = { 'proj/Nota.md': '', 'proj/img.png': '', 'proj/sub/Outra.md': '', 'Nota.md': '', 'a.md': '[[proj/Nota]] ![[proj/img.png]] [[Outra]] [[Nota]]' };
  const up = linkUpdatesForRename(indexOf(texts), (p) => texts[p], 'proj', 'projeto');
  assert.equal(up.get('a.md'), '[[projeto/Nota]] ![[img.png]] [[Outra]] [[Nota]]');
});

test('uses the current text (an unsaved editor) and skips links inside code', () => {
  const texts = { 'Velha.md': '', 'a.md': 'salvo [[Velha]]' };
  const index = indexOf(texts);
  const current = { 'a.md': 'editado `[[Velha]]` e\r\n[[Velha|x]]', 'Velha.md': '' };
  const up = linkUpdatesForRename(index, (p) => current[p], 'Velha.md', 'Nova.md');
  assert.equal(up.get('a.md'), 'editado `[[Velha]]` e\r\n[[Nova|x]]');
});

test('links inside the renamed note itself are updated too', () => {
  const texts = { 'Velha.md': 'eu mesma [[Velha#topo]]' };
  const up = linkUpdatesForRename(indexOf(texts), (p) => texts[p], 'Velha.md', 'Nova.md');
  assert.equal(up.get('Velha.md'), 'eu mesma [[Nova#topo]]');
});

test('escaped table pipes survive', () => {
  const texts = { 'Velha.md': '', 'a.md': '| [[Velha\\|apelido]] |' };
  const up = linkUpdatesForRename(indexOf(texts), (p) => texts[p], 'Velha.md', 'Nova.md');
  assert.equal(up.get('a.md'), '| [[Nova\\|apelido]] |');
});
