'use strict';

const { parseLinks, resolveLink, createLookup } = require('./links');
const { linkTextFor } = require('./link-suggest');

// After renaming/moving `from` (a file or a folder) to `to`: the new text of every note whose
// [[links]] pointed into it, as Map(old note path → new text). Links are re-parsed from the
// current text (getText may return an editor's unsaved text) and resolved against the file list
// as it was before the rename; the new link text is the shortest one that resolves afterwards.
function linkUpdatesForRename(index, getText, from, to) {
  const map = (p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  const before = index.lookup;
  const after = createLookup(index.files.map(map));
  const updates = new Map();
  for (const source of index.files) {
    if (!/\.(md|markdown)$/i.test(source)) continue;
    const text = getText(source);
    if (typeof text !== 'string' || !text.includes('[[')) continue;
    const newSource = map(source);
    let result = text;
    let changed = false;
    for (const link of parseLinks(text).reverse()) {
      if (!link.target) continue;
      const resolved = resolveLink(link.target, before, source);
      if (!resolved || map(resolved) === resolved) continue;
      const start = link.from + (link.embed ? 3 : 2);
      const inner = text.slice(start, link.to - 2);
      const end = inner.search(/\\\||[#|]/);
      const targetLength = end === -1 ? inner.length : end;
      const replacement = linkTextFor(map(resolved), after, newSource);
      result = result.slice(0, start) + replacement + result.slice(start + targetLength);
      changed = true;
    }
    if (changed && result !== text) updates.set(source, result);
  }
  return updates;
}

module.exports = { linkUpdatesForRename };
