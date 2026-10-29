'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitAnswer, parseActions, cleanPath } = require('../src/shared/claude-actions');

test('parseActions reads create, edit and mkdir blocks', () => {
  const text = [
    'Vou criar a nota.',
    '<docx-action type="mkdir" path="Projetos/X"></docx-action>',
    '<docx-action type="create" path="Projetos/X/Plano.md">',
    '# Plano',
    '',
    '```js',
    'const a = 1;',
    '```',
    '</docx-action>',
    '<docx-action type="edit" path="Inbox.md">',
    'novo texto',
    '</docx-action>',
    'Pronto.',
  ].join('\n');
  assert.deepEqual(parseActions(text), [
    { type: 'mkdir', path: 'Projetos/X' },
    { type: 'create', path: 'Projetos/X/Plano.md', content: '# Plano\n\n```js\nconst a = 1;\n```' },
    { type: 'edit', path: 'Inbox.md', content: 'novo texto' },
  ]);
});

test('splitAnswer keeps text and actions in order and marks a block still streaming', () => {
  const pieces = splitAnswer('Antes\n<docx-action type="create" path="A.md">\nx\n</docx-action>\nDepois <docx-action type="create" path="B.md">\nmeio');
  assert.deepEqual(pieces.map((p) => p.kind), ['text', 'action', 'text', 'pending']);
  assert.equal(pieces[2].text.trim(), 'Depois');
  const final = splitAnswer('Use <docx-action type="create"> para criar.', { final: true });
  assert.deepEqual(final.map((p) => p.kind), ['text']);
});

test('splitAnswer flags blocks that cannot be applied', () => {
  const pieces = splitAnswer([
    '<docx-action type="delete" path="A.md"></docx-action>',
    '<docx-action type="create" path="../fora.md">x</docx-action>',
    '<docx-action type="create" path="script.sh">x</docx-action>',
  ].join('\n'));
  assert.deepEqual(pieces.map((p) => p.kind), ['invalid', 'invalid', 'invalid']);
  assert.match(pieces[0].error, /delete/);
  assert.match(pieces[1].error, /caminho/);
  assert.match(pieces[2].error, /não permitido/);
});

test('cleanPath accepts vault-relative paths only', () => {
  assert.equal(cleanPath('Pasta/Nota.md'), 'Pasta/Nota.md');
  assert.equal(cleanPath('./Pasta\\Nota.md'), 'Pasta/Nota.md');
  assert.equal(cleanPath('Pasta/'), 'Pasta');
  for (const bad of ['', '/etc/passwd', 'C:/x.md', '../x.md', 'a/../b.md', '.git/config', 'a//b.md', 'a/ b.md', 'a|b.md', undefined]) {
    assert.equal(cleanPath(bad), null, String(bad));
  }
});
