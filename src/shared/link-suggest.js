'use strict';

// Suggestions shown while typing [[ in the editor.

const { resolveLink, isNote } = require('./links');

const OPEN_RE = /(!?)\[\[([^[\]|#\n]*)$/;

// The unfinished [[… right before the cursor: { from (start of the query), query, embed }.
function wikilinkQuery(before) {
  const match = before.match(OPEN_RE);
  if (!match) return null;
  return { from: before.length - match[2].length, query: match[2], embed: match[1] === '!' };
}

// The part of the link name after the cursor ("[[fo|obar]]" → "obar") and whether "]]" follows it.
function wikilinkTail(after) {
  const length = after.match(/^[^[\]|#\n]*/)[0].length;
  return { length, closed: after.startsWith(']]', length) };
}

// "#", "|", "[" and "]" end or split a wikilink, so such files cannot be linked by name.
const UNLINKABLE_RE = /[#|[\]]/;
const collator = new Intl.Collator();

const nameOf = (rel) => rel.split('/').pop().replace(/\.(md|markdown)$/i, '').toLowerCase();

// Files matching `query`: name starts with it, then name contains it, then path contains it.
// Notes come before attachments within each group.
function suggestFiles(files, query) {
  const q = query.trim().toLowerCase();
  const ranked = [];
  for (const rel of files) {
    if (UNLINKABLE_RE.test(rel)) continue;
    const name = nameOf(rel);
    let rank;
    if (name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if (rel.toLowerCase().includes(q)) rank = 2;
    else continue;
    ranked.push({ rel, rank: rank * 2 + (isNote(rel) ? 0 : 1) });
  }
  return ranked.sort((a, b) => a.rank - b.rank || collator.compare(a.rel, b.rel)).map((r) => r.rel);
}

// Text to write inside [[ ]]: the bare name when it resolves to `rel` from `sourcePath`,
// otherwise the vault path. Notes drop ".md"; attachments keep their extension.
function linkTextFor(rel, lookup, sourcePath) {
  const full = isNote(rel) ? rel.replace(/\.(md|markdown)$/i, '') : rel;
  const name = full.split('/').pop();
  return resolveLink(name, lookup, sourcePath) === rel ? name : full;
}

const TEXT_RE = /\.(md|markdown|txt)$/i;
const ATTACHMENT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp3|wav|ogg|m4a|flac|mp4|webm|mov|mkv|zip|docx?|xlsx?|pptx?)$/i;

// File to create for a link with no target: a note ("x" → "x.md", dots in the name are kept), or
// null for attachments, which cannot be created empty.
function newNotePath(name) {
  if (TEXT_RE.test(name)) return name;
  if (ATTACHMENT_RE.test(name)) return null;
  return `${name}.md`;
}

module.exports = { wikilinkQuery, wikilinkTail, suggestFiles, linkTextFor, newNotePath };
