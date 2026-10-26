'use strict';

// Text-level helpers for Obsidian Markdown features: checklists, %%comments%% and the blocks the
// Live Preview renders as a whole (tables, $$ math, mermaid diagrams).

const { maskFences } = require('./links');

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

// The text with the index-th checklist item (counted outside code blocks) ticked or unticked.
function toggleTask(text, index) {
  const masked = maskFences(text).split('\n');
  const lines = text.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (masked[i] !== lines[i] || !TASK_RE.test(lines[i])) continue;
    if (n++ === index) {
      lines[i] = lines[i].replace(TASK_RE, (_m, a, mark, b) => `${a}${mark === ' ' ? 'x' : ' '}${b}`);
      return lines.join('\n');
    }
  }
  return text;
}

// %%comments%% are not shown when reading. Inline code and fenced code keep them.
function stripComments(text) {
  const masked = maskFences(text).replace(/(`+)[^`\n]*?\1/g, (m) => ' '.repeat(m.length));
  let out = '';
  let last = 0;
  const re = /%%[\s\S]*?%%/g;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    out += text.slice(last, m.index);
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  // A comment that filled whole lines leaves one empty line, not several.
  return out.replace(/\n{3,}/g, '\n\n');
}

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// [{ type: 'table'|'math'|'mermaid', from, to, content? }] in document order.
function markdownBlocks(text) {
  const lines = text.split('\n');
  const masked = maskFences(text).split('\n');
  const starts = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }
  const end = (i) => starts[i] + lines[i].length;
  const clean = (l) => l.replace(/\r$/, '');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*mermaid\s*$/i);
    if (fence && masked[i] !== lines[i]) {
      let j = i + 1;
      while (j < lines.length && !clean(lines[j]).trim().startsWith(fence[1])) j++;
      if (j < lines.length) {
        out.push({ type: 'mermaid', from: starts[i], to: end(j), content: lines.slice(i + 1, j).map(clean).join('\n') });
        i = j;
      }
      continue;
    }
    if (masked[i] !== lines[i]) continue;
    const single = line.match(/^\s*\$\$(.+?)\$\$\s*$/);
    if (single) {
      out.push({ type: 'math', from: starts[i], to: end(i), content: single[1].trim() });
      continue;
    }
    if (line.trim() === '$$') {
      let j = i + 1;
      while (j < lines.length && clean(lines[j]).trim() !== '$$') j++;
      if (j < lines.length) {
        out.push({ type: 'math', from: starts[i], to: end(j), content: lines.slice(i + 1, j).map(clean).join('\n') });
        i = j;
      }
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && masked[i + 1] === lines[i + 1]
      && DELIMITER_ROW.test(clean(lines[i + 1])) && clean(lines[i + 1]).includes('-')) {
      let j = i + 2;
      while (j < lines.length && masked[j] === lines[j] && clean(lines[j]).includes('|') && clean(lines[j]).trim()) j++;
      out.push({ type: 'table', from: starts[i], to: end(j - 1) });
      i = j - 1;
    }
  }
  return out;
}

module.exports = { toggleTask, stripComments, markdownBlocks };
