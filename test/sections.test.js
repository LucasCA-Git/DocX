'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sectionText } = require('../src/shared/metadata');

const note = [
  '---', 'tags: x', '---',
  '# Título',
  'intro',
  '## Parte A',
  'texto a',
  '### Sub A',
  'sub',
  '## Parte B',
  'texto b',
  'parágrafo com bloco',
  'continua ^bl1',
  '',
  'outro',
].join('\n');

test('sectionText: whole note without front matter', () => {
  assert.equal(sectionText(note, null).split('\n')[0], '# Título');
});

test('sectionText: a heading up to the next heading of the same or higher level', () => {
  assert.equal(sectionText(note, 'Parte A'), '## Parte A\ntexto a\n### Sub A\nsub');
  assert.equal(sectionText(note, 'parte b'), '## Parte B\ntexto b\nparágrafo com bloco\ncontinua ^bl1\n\noutro');
  assert.equal(sectionText(note, 'Inexistente'), null);
});

test('sectionText: a block is its paragraph (or list item), without the ^id', () => {
  assert.equal(sectionText(note, '^bl1'), 'texto b\nparágrafo com bloco\ncontinua');
  assert.equal(sectionText('- a\n- b ^x\n- c', '^x'), '- b');
});
