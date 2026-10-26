'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toggleTask, stripComments, markdownBlocks } = require('../src/shared/markdown-extras');

test('toggleTask flips the n-th task outside code', () => {
  const text = '- [ ] um\n```\n- [ ] código\n```\n* [x] dois\n1. [ ] três';
  assert.equal(toggleTask(text, 0), '- [x] um\n```\n- [ ] código\n```\n* [x] dois\n1. [ ] três');
  assert.equal(toggleTask(text, 1), '- [ ] um\n```\n- [ ] código\n```\n* [ ] dois\n1. [ ] três');
  assert.equal(toggleTask(text, 2), '- [ ] um\n```\n- [ ] código\n```\n* [x] dois\n1. [x] três');
  assert.equal(toggleTask(text, 9), text);
});

test('stripComments removes %%…%% (also across lines) but not in code', () => {
  assert.equal(stripComments('a %%x%% b\n%%\nbloco\n%%\nc `%%k%%`'), 'a  b\n\nc `%%k%%`');
  assert.equal(stripComments('```\n%%x%%\n```'), '```\n%%x%%\n```');
});

test('markdownBlocks finds tables, $$ math and mermaid fences with offsets', () => {
  const text = [
    'texto',
    '| a | b |',
    '|---|:-:|',
    '| 1 | 2 |',
    '',
    '$$',
    'x^2',
    '$$',
    '```mermaid',
    'graph TD; A-->B',
    '```',
    '```',
    '| não | é |',
    '|---|---|',
    '```',
    '$$y$$',
  ].join('\n');
  const blocks = markdownBlocks(text).map((b) => [b.type, text.slice(b.from, b.to), b.content ?? null]);
  assert.deepEqual(blocks, [
    ['table', '| a | b |\n|---|:-:|\n| 1 | 2 |', null],
    ['math', '$$\nx^2\n$$', 'x^2'],
    ['mermaid', '```mermaid\ngraph TD; A-->B\n```', 'graph TD; A-->B'],
    ['math', '$$y$$', 'y'],
  ]);
});
