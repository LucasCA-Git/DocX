'use strict';

// Search syntax: words are ANDed; "exact phrase"; -word excludes; OR between
// groups; operators tag:, path:, file:; /regex/flags.
// parseQuery → [[term, …] (one AND group), …]; term = { kind, value, negate, flags? }.

const OPERATORS = new Set(['tag', 'path', 'file']);
const TOKEN_RE = /(-?)(?:(\w+):)?(?:"([^"]*)"?|\/((?:\\.|[^/\\])+)\/([gimsuy]*)(?=\s|$)|(\S+))/gy;

function parseQuery(query) {
  const groups = [];
  let current = [];
  const text = query.trim();
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    TOKEN_RE.lastIndex = i;
    const m = TOKEN_RE.exec(text);
    if (!m) break;
    i = TOKEN_RE.lastIndex;
    const [, minus, op, quoted, regex, flags, word] = m;
    const negate = minus === '-';
    if (!op && !negate && word === 'OR') {
      if (current.length) groups.push(current);
      current = [];
      continue;
    }
    if (regex !== undefined && !op) {
      current.push({ kind: 'regex', value: regex, flags: flags ?? '', negate });
      continue;
    }
    let value = quoted ?? word ?? (regex !== undefined ? `/${regex}/${flags}` : '');
    if (op && OPERATORS.has(op.toLowerCase())) {
      const kind = op.toLowerCase();
      if (kind === 'tag') value = value.replace(/^#/, '');
      if (value) current.push({ kind, value, negate });
    } else if (op) {
      // Unknown "x:y" is plain text.
      current.push({ kind: 'text', value: `${op}:${value}`, negate });
    } else if (value) {
      current.push({ kind: 'text', value, negate });
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

module.exports = { parseQuery };
