'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parser, GFM } = require('@lezer/markdown');

const { livePreview } = require('../src/shared/live-preview');

const { ExtendedMarkdown } = require('../src/shared/md-extensions');

const md = parser.configure([GFM, ExtendedMarkdown]);

// Items for `text` with the cursor on the lines that contain `activeAt` offsets.
function run(text, activeAt = []) {
  const lineOf = (pos) => text.slice(0, pos).split('\n').length;
  const active = new Set(activeAt.map(lineOf));
  return livePreview({
    text,
    tree: md.parse(text),
    isActive: (from, to) => {
      for (let l = lineOf(from); l <= lineOf(to); l++) if (active.has(l)) return true;
      return false;
    },
  });
}

const pick = (items, type) => items.filter((i) => i.type === type);
const spans = (items, type) => pick(items, type).map((i) => [i.from, i.to]);

test('headings get a line class and hide "# " away from the cursor', () => {
  const items = run('# Título\ntexto');
  assert.deepEqual(pick(items, 'line'), [{ type: 'line', from: 0, cls: 'lp-h1' }]);
  assert.deepEqual(spans(items, 'hide'), [[0, 2]]);
});

test('the line with the cursor keeps its syntax visible', () => {
  const items = run('# Título\ntexto', [3]);
  assert.deepEqual(pick(items, 'line'), [{ type: 'line', from: 0, cls: 'lp-h1' }]);
  assert.deepEqual(spans(items, 'hide'), []);
});

test('bold, italic, strike and inline code are styled and their marks hidden', () => {
  const text = '**b** *i* ~~s~~ `c`';
  const items = run(text);
  assert.deepEqual(pick(items, 'mark').map((m) => [m.from, m.to, m.cls]), [
    [0, 5, 'lp-strong'], [6, 9, 'lp-em'], [10, 15, 'lp-strike'], [16, 19, 'lp-code'],
  ]);
  assert.deepEqual(spans(items, 'hide'), [[0, 2], [3, 5], [6, 7], [8, 9], [10, 12], [13, 15], [16, 17], [18, 19]]);
  // Marks stay styled on the cursor line too, only the syntax shows.
  assert.equal(pick(run(text, [0]), 'mark').length, 4);
  assert.equal(pick(run(text, [0]), 'hide').length, 0);
});

test('markdown links show only their text', () => {
  const items = run('ver [site](https://x.com) fim');
  assert.deepEqual(pick(items, 'mark'), [{ type: 'mark', from: 4, to: 25, cls: 'lp-link', href: 'https://x.com' }]);
  assert.deepEqual(spans(items, 'hide'), [[4, 5], [9, 25]]);
});

test('wikilinks and embeds become widgets, not markdown links', () => {
  const items = run('a [[Nota|apelido]] b ![[img.png|100]] [[Outra#Seção]]');
  assert.deepEqual(pick(items, 'wikilink').map((w) => [w.from, w.to, w.target, w.subpath, w.label]), [
    [2, 18, 'Nota', null, 'apelido'],
    [38, 53, 'Outra', 'Seção', 'Outra > Seção'],
  ]);
  assert.deepEqual(pick(items, 'embed').map((e) => [e.from, e.to, e.target, e.alias]), [[21, 37, 'img.png', '100']]);
  assert.deepEqual(pick(items, 'mark'), []);
  assert.deepEqual(pick(items, 'hide'), []);
});

test('wikilinks on the cursor line stay as text', () => {
  assert.deepEqual(pick(run('a [[Nota]]', [0]), 'wikilink'), []);
});

test('lists, tasks, quotes and rules', () => {
  const text = '- item\n- [ ] fazer\n- [x] feito\n\n> citação\n\n---\n';
  const items = run(text);
  assert.deepEqual(pick(items, 'bullet').map((b) => [b.from, b.to]), [[0, 1]]);
  assert.deepEqual(pick(items, 'task').map((t) => [t.from, t.to, t.checked, t.marker]), [[7, 12, false, 9], [19, 24, true, 21]]);
  assert.deepEqual(pick(items, 'line').map((l) => [l.from, l.cls]), [[32, 'lp-quote']]);
  assert.deepEqual(spans(items, 'hide'), [[32, 34]]);
  assert.deepEqual(pick(items, 'hr').map((h) => [h.from, h.to]), [[43, 46]]);
});

test('ordered list numbers stay as typed', () => {
  assert.deepEqual(pick(run('1. um\n2. dois'), 'bullet'), []);
});

test('nothing inside code blocks is touched except the block lines', () => {
  const text = '```js\n**x** [[no]]\n```';
  const items = run(text);
  assert.deepEqual(pick(items, 'line').map((l) => [l.from, l.cls]), [[0, 'lp-codeblock lp-codeblock-begin'], [6, 'lp-codeblock'], [19, 'lp-codeblock lp-codeblock-end']]);
  assert.deepEqual(items.filter((i) => i.type !== 'line'), []);
});

test('only the requested ranges are scanned', () => {
  const text = '# A\n\n# B\n';
  const tree = md.parse(text);
  const items = livePreview({ text, tree, isActive: () => false, ranges: [{ from: 5, to: 8 }] });
  assert.deepEqual(pick(items, 'line'), [{ type: 'line', from: 5, cls: 'lp-h1' }]);
});

test('nothing hidden or replaced ever crosses a line break', () => {
  for (const text of ['[a](\nhttp://x)', '[a](http://x\n"title")', '[a](http://x "ti\ntle")']) {
    const items = run(text + '\n\nfim');
    for (const item of items.filter((i) => i.type !== 'line' && i.type !== 'mark')) {
      assert.ok(!text.slice(item.from, item.to).includes('\n'), `${item.type} ${item.from}-${item.to} in ${JSON.stringify(text)}`);
    }
  }
});

test('YAML front matter is left alone and marked', () => {
  const text = '---\ntitle: x\n---\n\ntexto';
  const items = run(text);
  assert.deepEqual(items.map((i) => [i.type, i.from, i.cls]), [['line', 0, 'lp-frontmatter'], ['line', 4, 'lp-frontmatter'], ['line', 13, 'lp-frontmatter']]);
});

test('setext underline is hidden away from the cursor', () => {
  const items = run('Título\n===\n\nfim');
  assert.deepEqual(pick(items, 'line'), [{ type: 'line', from: 0, cls: 'lp-h1' }]);
  assert.deepEqual(spans(items, 'hide'), [[7, 10]]);
  assert.deepEqual(spans(run('Título\n===\n\nfim', [8]), 'hide'), []);
});

test('a markdown link wrapped around a wikilink does not hide inside it', () => {
  const items = run('[[x]](http://y)');
  assert.deepEqual(pick(items, 'wikilink').map((w) => [w.from, w.to]), [[0, 5]]);
  for (const h of pick(items, 'hide')) assert.ok(h.from >= 5, `hide ${h.from}-${h.to}`);
});

test('tasks inside quotes do not overlap the quote mark', () => {
  const items = run('> - [ ] a');
  assert.deepEqual(spans(items, 'hide'), [[0, 2]]);
  assert.deepEqual(pick(items, 'task').map((t) => [t.from, t.to]), [[2, 7]]);
});

test('#tags are marked as tags (not inside code or headings marks)', () => {
  const text = '# Título #topo\nver #projeto e `#nao`';
  const tags = run(text).filter((i) => i.type === 'mark' && i.cls === 'lp-tag');
  assert.deepEqual(tags.map((t) => [text.slice(t.from, t.to), t.tag]), [['#topo', 'topo'], ['#projeto', 'projeto']]);
});

test('^block ids at the end of a line are hidden away from the cursor', () => {
  const text = 'linha com bloco ^abc1\noutra';
  assert.deepEqual(spans(run(text), 'hide'), [[15, 21]]);
  assert.deepEqual(spans(run(text, [3]), 'hide'), []);
});

test('==highlight==, %%comments%% and $math$', () => {
  const text = 'a ==marcado== b %%oculto%% c $x^2$ custa $5 e $10';
  const items = run(text);
  const marks = pick(items, 'mark').map((m) => [m.cls, text.slice(m.from, m.to)]);
  assert.deepEqual(marks, [['lp-highlight', '==marcado=='], ['lp-comment', '%%oculto%%']]);
  assert.deepEqual(pick(items, 'math').map((m) => [m.tex, text.slice(m.from, m.to)]), [['x^2', '$x^2$']]);
  assert.deepEqual(spans(items, 'hide').map(([a, b]) => text.slice(a, b)), ['==', '==']);
  // On the cursor line everything stays raw.
  assert.deepEqual(pick(run(text, [0]), 'math'), []);
});

test('callouts get their type as line class and the [!type] marker hidden', () => {
  const text = '> [!Tip]- Título\n> corpo';
  const items = run(text);
  assert.deepEqual(pick(items, 'line').map((l) => l.cls), ['lp-callout lp-callout-tip lp-callout-title', 'lp-callout lp-callout-tip']);
  assert.ok(spans(items, 'hide').some(([a, b]) => text.slice(a, b) === '[!Tip]- '));
});
