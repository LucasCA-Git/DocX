'use strict';

// Live Preview model: from the markdown syntax tree (Lezer, the one CodeMirror uses) and the
// wikilinks, the list of things the editor should style, hide or replace. Pure, so it is tested in
// Node; the editor turns each item into a CodeMirror decoration.
//
// Items: { type: 'line', from, cls }            class on the line starting at `from`
//        { type: 'mark', from, to, cls, href?, tag? } styled inline range
//        { type: 'hide', from, to }             syntax hidden away from the cursor
//        { type: 'wikilink', from, to, target, subpath, label }
//        { type: 'embed', from, to, target, subpath, alias }
//        { type: 'bullet' | 'hr', from, to }
//        { type: 'math', from, to, tex }               inline $…$ rendered
//        { type: 'task', from, to, checked, marker }   marker = offset of "[ ]"

const { parseLinks } = require('./links');
const { parseTags } = require('./metadata');
const { parseCalloutLine } = require('./callouts');

const INLINE = {
  StrongEmphasis: 'lp-strong', Emphasis: 'lp-em', Strikethrough: 'lp-strike', InlineCode: 'lp-code', Highlight: 'lp-highlight', Comment: 'lp-comment',
};
const INLINE_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'HighlightMark']);

const FRONT_MATTER_RE = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)/;
const WIDGETS = new Set(['wikilink', 'embed', 'bullet', 'task', 'hr', 'math']);

const noteName = (target) => target.split('/').pop().replace(/\.(md|markdown)$/i, '');

function wikilinkLabel(link) {
  if (link.alias) return link.alias;
  const name = link.target ? noteName(link.target) : '';
  return link.subpath ? `${name}${name ? ' > ' : ''}${link.subpath}` : name;
}

function lineStarts(text, from, to) {
  const out = [];
  let pos = text.lastIndexOf('\n', from - 1) + 1;
  while (pos <= to) {
    out.push(pos);
    const next = text.indexOf('\n', pos);
    if (next === -1) break;
    pos = next + 1;
  }
  return out;
}

// text: whole document; tree: its Lezer tree; isActive(from, to): whether the cursor is on any line
// of that range; ranges: parts to scan (the editor passes the visible ones); links: parseLinks(text)
// when the caller already has it.
function livePreview({ text, tree, isActive, ranges = [{ from: 0, to: text.length }], links = null, tags = null }) {
  const items = [];
  const seen = new Set();
  // CodeMirror cannot hide or replace line breaks from a view plugin: hidden ranges are split per
  // line, widgets that would span lines are dropped.
  const add = (item) => {
    if (item.to !== undefined && text.slice(item.from, item.to).includes('\n')) {
      if (WIDGETS.has(item.type)) return;
      if (item.type === 'hide') {
        let start = item.from;
        for (const part of text.slice(item.from, item.to).split('\n')) {
          if (part) push({ ...item, from: start, to: start + part.length });
          start += part.length + 1;
        }
        return;
      }
    }
    push(item);
  };
  const push = (item) => {
    const key = `${item.type}:${item.from}:${item.to ?? ''}:${item.cls ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  const hideMark = (from, to) => add({ type: 'hide', from, to: text[to] === ' ' ? to + 1 : to });
  // Front matter (YAML between --- lines at the very top) is metadata, not Markdown.
  const frontMatterEnd = text.match(FRONT_MATTER_RE)?.[0].length ?? 0;
  if (frontMatterEnd) {
    for (const start of lineStarts(text, 0, frontMatterEnd - 1)) add({ type: 'line', from: start, cls: 'lp-frontmatter' });
  }
  const allLinks = (links ?? parseLinks(text)).filter((l) => l.from >= frontMatterEnd);

  for (const range of ranges) {
    // ^block ids at the end of a line.
    for (const start of lineStarts(text, range.from, range.to)) {
      const end = text.indexOf('\n', start);
      const line = text.slice(start, end === -1 ? text.length : end);
      const m = line.match(/\s\^[A-Za-z0-9-]+\s*$/);
      if (m && start >= frontMatterEnd && !isActive(start, start + line.length)) {
        add({ type: 'hide', from: start + m.index, to: start + line.length });
      }
    }
    for (const t of tags ?? parseTags(text)) {
      if (t.from < range.to && t.to > range.from) add({ type: 'mark', from: t.from, to: t.to, cls: 'lp-tag', tag: t.tag });
    }
    const wikilinks = allLinks.filter((l) => l.from < range.to && l.to > range.from);
    for (const link of wikilinks) {
      if (isActive(link.from, link.to)) continue;
      if (link.embed) add({ type: 'embed', from: link.from, to: link.to, target: link.target, subpath: link.subpath, alias: link.alias });
      else add({ type: 'wikilink', from: link.from, to: link.to, target: link.target, subpath: link.subpath, label: wikilinkLabel(link) });
    }
    const insideWikilink = (from, to) => wikilinks.some((l) => from >= l.from && to <= l.to);

    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (n) => {
        const { name, from, to } = n;
        if (insideWikilink(from, to)) return false;
        if (name !== 'Document' && from < frontMatterEnd) return false;

        if (name === 'FencedCode' || name === 'CodeBlock') {
          const starts = lineStarts(text, from, to);
          starts.forEach((start, i) => {
            let cls = 'lp-codeblock';
            if (name === 'FencedCode' && i === 0) cls += ' lp-codeblock-begin';
            if (name === 'FencedCode' && i === starts.length - 1 && i > 0) cls += ' lp-codeblock-end';
            add({ type: 'line', from: start, cls });
          });
          return false;
        }

        const heading = name.match(/^(?:ATX|Setext)Heading(\d)$/);
        if (heading) {
          add({ type: 'line', from: lineStarts(text, from, from)[0], cls: `lp-h${heading[1]}` });
          return undefined;
        }
        if (name === 'HeaderMark') {
          const parent = n.node.parent;
          if (!parent || isActive(parent.from, parent.to)) return undefined;
          if (/^ATXHeading/.test(parent.name) && from === parent.from) hideMark(from, to);
          if (/^SetextHeading/.test(parent.name)) add({ type: 'hide', from, to });
          return undefined;
        }

        if (name === 'InlineMath') {
          if (!isActive(from, to)) add({ type: 'math', from, to, tex: text.slice(from + 1, to - 1) });
          return false;
        }
        if (INLINE[name]) {
          add({ type: 'mark', from, to, cls: INLINE[name] });
          return undefined;
        }
        if (INLINE_MARKS.has(name)) {
          const parent = n.node.parent;
          if (parent && INLINE[parent.name] && !isActive(parent.from, parent.to)) add({ type: 'hide', from, to });
          return undefined;
        }

        if (name === 'Link') {
          const url = n.node.getChild('URL');
          const marks = n.node.getChildren('LinkMark');
          if (!url || marks.length < 2) return false;
          add({ type: 'mark', from, to, cls: 'lp-link', href: text.slice(url.from, url.to) });
          if (!isActive(from, to)) {
            add({ type: 'hide', from, to: marks[0].to });
            add({ type: 'hide', from: marks[1].from, to });
          }
          return false;
        }

        if (name === 'Blockquote') {
          const starts = lineStarts(text, from, to);
          const firstEnd = text.indexOf('\n', starts[0]);
          const callout = parseCalloutLine(text.slice(starts[0], firstEnd === -1 ? text.length : firstEnd));
          starts.forEach((start, i) => {
            const cls = callout ? `lp-callout lp-callout-${callout.type}${i === 0 ? ' lp-callout-title' : ''}` : 'lp-quote';
            add({ type: 'line', from: start, cls });
          });
          if (callout && !isActive(starts[0], starts[0] + callout.markerTo)) {
            add({ type: 'hide', from: starts[0] + callout.markerFrom, to: starts[0] + callout.markerTo });
          }
          return undefined;
        }
        if (name === 'QuoteMark') {
          if (!isActive(from, to)) hideMark(from, to);
          return undefined;
        }

        if (name === 'ListMark') {
          if (isActive(from, to)) return undefined;
          const item = n.node.parent;
          const task = item?.getChild('Task')?.getChild('TaskMarker');
          if (task) {
            add({ type: 'task', from, to: task.to, checked: /[xX]/.test(text[task.from + 1]), marker: task.from });
          } else if (item?.parent?.name === 'BulletList') {
            add({ type: 'bullet', from, to });
          }
          return undefined;
        }

        if (name === 'HorizontalRule') {
          if (!isActive(from, to)) add({ type: 'hr', from, to });
          return false;
        }
        return undefined;
      },
    });
  }
  return items.sort((a, b) => a.from - b.from);
}

module.exports = { livePreview, wikilinkLabel };
