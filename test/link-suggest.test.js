'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { wikilinkQuery, wikilinkTail, suggestFiles, linkTextFor, newNotePath } = require('../src/shared/link-suggest');
const { createLookup, linkAt } = require('../src/shared/links');

test('wikilinkQuery finds an open [[ before the cursor', () => {
  assert.deepEqual(wikilinkQuery('veja [[Dep'), { from: 7, query: 'Dep', embed: false });
  assert.deepEqual(wikilinkQuery('![['), { from: 3, query: '', embed: true });
  assert.deepEqual(wikilinkQuery('a [[x]] e [[Pas/N'), { from: 12, query: 'Pas/N', embed: false });
});

test('wikilinkQuery ignores closed links, aliases, headings and plain text', () => {
  assert.equal(wikilinkQuery('a [[x]] b'), null);
  assert.equal(wikilinkQuery('[[nota|apel'), null);
  assert.equal(wikilinkQuery('[[nota#tít'), null);
  assert.equal(wikilinkQuery('texto [ solto'), null);
});

const FILES = [
  'Deploy/Deploy Front_End.md',
  'Deploy/Deploy Front_manual.md',
  'Notas/Sobre deploy.md',
  'Terminus SFTP.png',
  'Outra.md',
];

test('suggestFiles ranks name prefix, then name contains, then path contains', () => {
  assert.deepEqual(suggestFiles(FILES, 'dep'), [
    'Deploy/Deploy Front_End.md',
    'Deploy/Deploy Front_manual.md',
    'Notas/Sobre deploy.md',
  ]);
  assert.deepEqual(suggestFiles(FILES, 'notas/'), ['Notas/Sobre deploy.md']);
  assert.deepEqual(suggestFiles(FILES, 'term'), ['Terminus SFTP.png']);
});

test('suggestFiles with an empty query lists notes before attachments', () => {
  assert.deepEqual(suggestFiles(FILES, '').slice(-1), ['Terminus SFTP.png']);
  assert.equal(suggestFiles(FILES, '').length, FILES.length);
});

test('linkTextFor uses the shortest text that still resolves to the file', () => {
  const lookup = createLookup([...FILES, 'Arquivo/Outra.md']);
  assert.equal(linkTextFor('Deploy/Deploy Front_End.md', lookup, 'Outra.md'), 'Deploy Front_End');
  assert.equal(linkTextFor('Terminus SFTP.png', lookup, 'Outra.md'), 'Terminus SFTP.png');
  assert.equal(linkTextFor('Arquivo/Outra.md', lookup, 'Notas/Sobre deploy.md'), 'Arquivo/Outra');
});

test('linkAt returns the link under a position', () => {
  const text = 'veja [[Deploy|o deploy]] e ![[img.png]]';
  assert.equal(linkAt(text, 8).target, 'Deploy');
  assert.equal(linkAt(text, 5).target, 'Deploy');
  assert.equal(linkAt(text, 24), null);
  assert.equal(linkAt(text, 30).embed, true);
  assert.equal(linkAt('`[[x]]`', 3), null);
});

test('wikilinkTail covers the rest of the link name after the cursor', () => {
  assert.deepEqual(wikilinkTail(']]'), { length: 0, closed: true });
  assert.deepEqual(wikilinkTail('obar]] fim'), { length: 4, closed: true });
  assert.deepEqual(wikilinkTail('obar|apelido]]'), { length: 4, closed: false });
  assert.deepEqual(wikilinkTail(' resto da linha'), { length: 15, closed: false });
  assert.deepEqual(wikilinkTail(''), { length: 0, closed: false });
});

test('suggestFiles skips names that cannot be written inside [[ ]]', () => {
  assert.deepEqual(suggestFiles(['a#b.md', 'c|d.md', 'e[f].md', 'ok.md'], ''), ['ok.md']);
});

test('suggestFiles matches .markdown notes by name', () => {
  assert.deepEqual(suggestFiles(['Velha.markdown', 'x.md'], 'vel'), ['Velha.markdown']);
});

test('linkTextFor writes the path when the name resolves to another folder first', () => {
  const lookup = createLookup(['A/Nota.md', 'B/Nota.md']);
  assert.equal(linkTextFor('A/Nota.md', lookup, 'A/x.md'), 'Nota');
  assert.equal(linkTextFor('B/Nota.md', lookup, 'A/x.md'), 'B/Nota');
  assert.equal(linkTextFor('B/Nota.md', lookup, 'B/y.md'), 'Nota');
  assert.equal(linkTextFor('Velha.markdown', createLookup(['Velha.markdown']), null), 'Velha');
});

test('newNotePath adds .md, keeps text extensions and refuses attachments', () => {
  assert.equal(newNotePath('Nova'), 'Nova.md');
  assert.equal(newNotePath('Reunião 2024.05'), 'Reunião 2024.05.md');
  assert.equal(newNotePath('Notes v1.2'), 'Notes v1.2.md');
  assert.equal(newNotePath('pasta/x.md'), 'pasta/x.md');
  assert.equal(newNotePath('a.txt'), 'a.txt');
  assert.equal(newNotePath('foto.png'), null);
  assert.equal(newNotePath('doc.PDF'), null);
});

test('linkAt boundaries, heading-only and aliased links', () => {
  const text = '[[A]] [[#Título]] [[B|b]]';
  assert.equal(linkAt(text, 0).target, 'A');
  assert.equal(linkAt(text, 5), null);
  assert.equal(linkAt(text, 6).subpath, 'Título');
  assert.equal(linkAt(text, 20).alias, 'b');
});
