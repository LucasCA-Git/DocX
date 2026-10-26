'use strict';

// Editing commands as pure functions over the document text: each returns
// { changes: [{ from, to, insert }], selection: { anchor, head } } for CodeMirror to apply.

// Toggles inline markers (**, *, ~~, ==, `, %%) around a selection.
function wrap(doc, from, to, open, close = open) {
  const inner = doc.slice(from, to);
  if (from !== to && inner.startsWith(open) && inner.endsWith(close) && inner.length >= open.length + close.length) {
    const text = inner.slice(open.length, inner.length - close.length);
    return { changes: [{ from, to, insert: text }], selection: { anchor: from, head: from + text.length } };
  }
  if (doc.slice(from - open.length, from) === open && doc.slice(to, to + close.length) === close) {
    return {
      changes: [{ from: from - open.length, to: from, insert: '' }, { from: to, to: to + close.length, insert: '' }],
      selection: { anchor: from - open.length, head: to - open.length },
    };
  }
  return {
    changes: [{ from, to, insert: `${open}${inner}${close}` }],
    selection: { anchor: from + open.length, head: to + open.length },
  };
}

const LIST_RE = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const QUOTE_RE = /^>\s?/;
const HEADING_RE = /^#{1,6}\s+/;

function lineRange(doc, from, to) {
  const start = doc.lastIndexOf('\n', from - 1) + 1;
  const nl = doc.indexOf('\n', to);
  return { start, end: nl === -1 ? doc.length : nl };
}

// Maps old positions in the changed region to new ones (shift by the length difference of each
// line's prefix), keeping the caret on the same character.
function rewriteLines(doc, from, to, transform) {
  const { start, end } = lineRange(doc, from, to);
  const lines = doc.slice(start, end).split('\n');
  const result = lines.map((line, i) => transform(line, i, lines));
  const map = (pos) => {
    let o = start;
    let n = start;
    for (let i = 0; i < lines.length; i++) {
      const delta = result[i].text.length - lines[i].length;
      if (pos <= o + lines[i].length) return n + Math.max(result[i].prefixNew, pos - o + delta);
      o += lines[i].length + 1;
      n += result[i].text.length + 1;
    }
    return pos;
  };
  return {
    changes: [{ from: start, to: end, insert: result.map((r) => r.text).join('\n') }],
    selection: { anchor: map(from), head: map(to) },
  };
}

const PREFIX = { bullet: '- ', task: '- [ ] ', quote: '> ' };

// kind: 'bullet' | 'number' | 'task' | 'quote' | 'h1'…'h6'. All lines already of that kind → removed.
function linePrefix(doc, from, to, kind) {
  const { start, end } = lineRange(doc, from, to);
  const lines = doc.slice(start, end).split('\n');
  const heading = /^h([1-6])$/.exec(kind);
  const has = (line) => {
    if (kind === 'quote') return QUOTE_RE.test(line);
    if (heading) return new RegExp(`^#{${heading[1]}}\\s`).test(line);
    const m = line.match(LIST_RE);
    if (!m) return false;
    if (kind === 'task') return /\[[ xX]\]/.test(m[0]);
    if (kind === 'number') return /\d/.test(m[0]);
    return !/\d|\[/.test(m[0]);
  };
  const remove = lines.every(has);
  return rewriteLines(doc, from, to, (line, i) => {
    let body = line;
    let indent = '';
    if (kind === 'quote') {
      body = remove ? line.replace(QUOTE_RE, '') : line;
      const text = remove ? body : `> ${body}`;
      return { text, prefixNew: remove ? 0 : 2 };
    }
    if (heading) {
      body = line.replace(HEADING_RE, '');
      const prefix = remove ? '' : `${'#'.repeat(Number(heading[1]))} `;
      return { text: prefix + body, prefixNew: prefix.length };
    }
    const m = line.match(LIST_RE);
    if (m) {
      indent = m[1];
      body = line.slice(m[0].length);
    } else {
      indent = line.match(/^\s*/)[0];
      body = line.slice(indent.length);
    }
    if (remove) return { text: indent + body, prefixNew: indent.length };
    const prefix = kind === 'number' ? `${i + 1}. ` : PREFIX[kind];
    return { text: indent + prefix + body, prefixNew: indent.length + prefix.length };
  });
}

// Ctrl+L like Obsidian: plain text → "- [ ] ", list item → task, [ ] ↔ [x].
function cycleTask(doc, from, to) {
  return rewriteLines(doc, from, to, (line) => {
    const task = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*)/);
    if (task) {
      const text = `${task[1]}${task[2] === ' ' ? 'x' : ' '}${task[3]}${line.slice(task[0].length)}`;
      return { text, prefixNew: task[0].length };
    }
    const list = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)/);
    if (list) return { text: `${list[1]}[ ] ${line.slice(list[0].length)}`, prefixNew: list[0].length + 4 };
    const indent = line.match(/^\s*/)[0];
    return { text: `${indent}- [ ] ${line.slice(indent.length)}`, prefixNew: indent.length + 6 };
  });
}

// Ctrl+K: [selection](|) or, when the selection is a URL, [|](url).
function insertLink(doc, from, to) {
  const sel = doc.slice(from, to);
  if (/^https?:\/\/\S+$/.test(sel)) {
    return { changes: [{ from, to, insert: `[](${sel})` }], selection: { anchor: from + 1 } };
  }
  const insert = `[${sel}]()`;
  return { changes: [{ from, to, insert }], selection: { anchor: sel ? from + insert.length - 1 : from + 1 } };
}

module.exports = { wrap, linePrefix, cycleTask, insertLink };
