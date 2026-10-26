'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap, linePrefix, cycleTask, insertLink } = require('../src/shared/formatting');

// Applies {changes, selection} to a doc for easy assertions; "|" marks the selection in results.
function apply(doc, { changes, selection }) {
  let out = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  const { anchor, head = anchor } = selection;
  const [a, b] = [Math.min(anchor, head), Math.max(anchor, head)];
  return a === b ? `${out.slice(0, a)}|${out.slice(a)}` : `${out.slice(0, a)}[${out.slice(a, b)}]${out.slice(b)}`;
}

test('wrap adds and removes bold/italic/code markers', () => {
  assert.equal(apply('um dois', wrap('um dois', 3, 7, '**')), 'um **[dois]**');
  assert.equal(apply('um **dois**', wrap('um **dois**', 5, 9, '**')), 'um [dois]');
  assert.equal(apply('um **dois**', wrap('um **dois**', 3, 11, '**')), 'um [dois]');
  assert.equal(apply('ab', wrap('ab', 1, 1, '==')), 'a==|==b');
  assert.equal(apply('a', wrap('a', 0, 1, '%%')), '%%[a]%%');
});

test('linePrefix toggles lists, quotes and headings over the selected lines', () => {
  const doc = 'um\ndois\ntrês';
  assert.equal(apply(doc, linePrefix(doc, 0, 6, 'bullet')), '- [um\n- doi]s\ntrês');
  assert.equal(apply('- um\n- dois', linePrefix('- um\n- dois', 0, 11, 'bullet')), '[um\ndois]');
  assert.equal(apply('a\nb', linePrefix('a\nb', 0, 3, 'number')), '1. [a\n2. b]');
  assert.equal(apply('- a', linePrefix('- a', 3, 3, 'quote')), '> - a|');
  assert.equal(apply('## T', linePrefix('## T', 4, 4, 'h1')), '# T|');
  assert.equal(apply('# T', linePrefix('# T', 3, 3, 'h1')), 'T|');
  assert.equal(apply('- [ ] x', linePrefix('- [ ] x', 7, 7, 'number')), '1. x|');
});

test('cycleTask: text → [ ] → [x] → [ ]', () => {
  assert.equal(apply('fazer', cycleTask('fazer', 5, 5)), '- [ ] fazer|');
  assert.equal(apply('- fazer', cycleTask('- fazer', 7, 7)), '- [ ] fazer|');
  assert.equal(apply('- [ ] fazer', cycleTask('- [ ] fazer', 11, 11)), '- [x] fazer|');
  assert.equal(apply('  * [x] fazer', cycleTask('  * [x] fazer', 13, 13)), '  * [ ] fazer|');
});

test('insertLink: selection becomes the text, a URL becomes the target', () => {
  assert.equal(apply('ver site', insertLink('ver site', 4, 8)), 'ver [site](|)');
  assert.equal(apply('https://x.com', insertLink('https://x.com', 0, 13)), '[|](https://x.com)');
  assert.equal(apply('', insertLink('', 0, 0)), '[|]()');
});

test('italic on bold text adds a marker instead of stripping the bold', () => {
  assert.equal(apply('**negrito**', wrap('**negrito**', 0, 11, '*')), '*[**negrito**]*');
  assert.equal(apply('a **b** c', wrap('a **b** c', 4, 5, '*')), 'a ***[b]*** c');
});
