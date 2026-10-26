'use strict';

// Backlinks panel and vault search: pure functions over the link index and note texts.
// Positions are { line, from/to within the line } (not absolute offsets): the editor normalizes
// CRLF to LF, so offsets into the file text would drift on Windows notes.

const { parseQuery } = require('./search-query');
const { maskFences } = require('./links');

const stripCR = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);

function countBreaks(text, from, to) {
  let n = 0;
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) n += 1;
  return n;
}

// Notes linking to `rel`, each with the lines where the links are ({ line, text }). getText(rel)
// returns the note's text, or undefined when it is not loaded (the note is still listed).
function backlinksFor(index, rel, getText) {
  return index.backlinks(rel).map((source) => {
    const text = getText(source);
    if (text === undefined) return { source, lines: [] };
    const lines = [];
    let line = 0;
    let scanned = 0;
    const links = index.outgoing(source).filter((l) => l.resolved === rel).sort((a, b) => a.from - b.from);
    for (const link of links) {
      line += countBreaks(text, scanned, link.from);
      scanned = link.from;
      if (lines.length && lines[lines.length - 1].line === line) continue;
      const start = text.lastIndexOf('\n', link.from - 1) + 1;
      const end = text.indexOf('\n', link.from);
      lines.push({ line, text: stripCR(text.slice(start, end === -1 ? text.length : end)) });
    }
    return { source, lines };
  });
}

const foldedChars = new Map();

// Lower case without accents, one output character per UTF-16 unit, so positions in the folded
// text are positions in the original. Non-ASCII characters are folded one by one (memoized) to a
// single lower-case character; the final toLowerCase then only touches ASCII and characters that
// are already lower case, so the length never changes.
function foldChar(c) {
  let f = foldedChars.get(c);
  if (f === undefined) {
    f = c.normalize('NFD')[0].toLowerCase();
    if (f.length !== 1) f = c.toLowerCase().length === 1 ? c.toLowerCase() : c;
    foldedChars.set(c, f);
  }
  return f;
}

function foldText(text) {
  return text.replace(/[^\x00-\x7f]/g, foldChar).toLowerCase();
}

const MAX_HITS = 2000;

function occurrences(haystack, needle) {
  const out = [];
  for (let at = haystack.indexOf(needle); at !== -1 && out.length < MAX_HITS; at = haystack.indexOf(needle, at + needle.length)) {
    out.push({ at, len: needle.length });
  }
  return out;
}

// A term as a test on one note: { ok, hits (offsets in its text), name (matched the file name) }.
function compileTerm(term, { fold, caseSensitive, tagsOf }) {
  if (term.kind === 'regex') {
    let re = null;
    try {
      const flags = new Set(`${term.flags}g`.replace(/[^gimsu]/g, ''));
      if (!caseSensitive) flags.add('i');
      re = new RegExp(term.value, [...flags].join(''));
    } catch {
      re = null;
    }
    return (note) => {
      if (!re) return { ok: false, hits: [] };
      const hits = [];
      re.lastIndex = 0;
      for (let m = re.exec(note.text); m && hits.length < MAX_HITS; m = re.exec(note.text)) {
        if (!m[0].length) {
          re.lastIndex++;
          continue;
        }
        hits.push({ at: m.index, len: m[0].length });
      }
      re.lastIndex = 0;
      const name = re.test(note.path);
      return { ok: hits.length > 0 || name, hits, name };
    };
  }
  const value = fold(term.value);
  if (term.kind === 'tag') {
    const tag = term.value.toLowerCase();
    return (note) => ({ ok: tagsOf(note.path).some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`)), hits: [] });
  }
  if (term.kind === 'path') return (note) => ({ ok: fold(note.path).includes(value), hits: [] });
  if (term.kind === 'file') return (note) => ({ ok: fold(note.path.split('/').pop()).includes(value), hits: [] });
  return (note) => {
    const hits = occurrences(note.folded, value);
    const name = fold(note.path).includes(value);
    return { ok: hits.length > 0 || name, hits, name };
  };
}

// Notes matching `query` (see search-query.js for the syntax; case and accents ignored unless
// caseSensitive). Each match is the first hit on a line: { line, text, from, to }. Files matching
// by name come first. `cache` (path → { text, folded }) keeps folded texts between searches;
// tagsOf(path) gives a note's tags for tag:.
function searchVault(texts, query, { maxFiles = 200, maxMatchesPerFile = 20, cache = null, tagsOf = () => [], caseSensitive = false, budgetMs = 2000 } = {}) {
  const groups = parseQuery(query);
  if (!groups.length) return [];
  const deadline = Date.now() + budgetMs;
  let timedOut = false;
  const fold = caseSensitive ? (t) => t : foldText;
  const compiled = groups.map((group) => group.map((term) => ({ term, test: compileTerm(term, { fold, caseSensitive, tagsOf }) })));
  const results = [];
  for (const [path, text] of texts) {
    // A slow /regex/ must not freeze the window: stop and say the result is partial.
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    let folded = text;
    if (!caseSensitive) {
      let entry = cache?.get(path);
      if (entry?.text !== text) {
        entry = { text, folded: foldText(text) };
        cache?.set(path, entry);
      }
      folded = entry.folded;
    }
    const note = { path, text, folded };
    let matched = false;
    let nameMatch = false;
    const hits = [];
    for (const group of compiled) {
      const found = [];
      let ok = true;
      for (const { term, test } of group) {
        const r = test(note);
        if (term.negate ? r.ok : !r.ok) {
          ok = false;
          break;
        }
        if (!term.negate) found.push(r);
      }
      if (!ok) continue;
      matched = true;
      for (const r of found) {
        hits.push(...r.hits);
        if (r.name) nameMatch = true;
      }
    }
    if (!matched) continue;
    hits.sort((a, b) => a.at - b.at);
    const matches = [];
    let total = 0;
    let line = 0;
    let scanned = 0;
    let lastLine = -1;
    for (const { at, len } of hits) {
      line += countBreaks(text, scanned, at);
      scanned = at;
      if (line === lastLine) continue;
      lastLine = line;
      total += 1;
      if (matches.length < maxMatchesPerFile) {
        const start = text.lastIndexOf('\n', at - 1) + 1;
        const nl = text.indexOf('\n', at);
        matches.push({ line, text: stripCR(text.slice(start, nl === -1 ? text.length : nl)), from: at - start, to: Math.min(at - start + len, (nl === -1 ? text.length : nl) - start) });
      }
    }
    results.push({ path, nameMatch, total, matches });
  }
  results.sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || b.total - a.total || a.path.localeCompare(b.path));
  const out = results.slice(0, maxFiles);
  Object.defineProperty(out, 'timedOut', { value: timedOut });
  return out;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Other notes mentioning `rel` by name (or one of its aliases) as plain text: whole words, not
// inside [[links]] or code. [{ source, lines: [{ line, text, from, to }] }] (first hit per line).
// cache: path → { text, folded } of the masked text, reused while a note is unchanged.
function unlinkedMentions(index, rel, texts, cache = null) {
  const name = rel.split('/').pop().replace(/\.(md|markdown)$/i, '');
  const names = [name, ...(index.metadata(rel)?.aliases ?? [])].filter((n) => n.trim().length >= 2);
  if (!names.length) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map((n) => escapeRe(foldText(n))).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  const out = [];
  for (const [source, text] of texts) {
    if (source === rel) continue;
    let entry = cache?.get(source);
    if (entry?.text !== text) {
      // Same length as the text: front matter, fenced code, inline code, wikilinks, Markdown
      // links, URLs and #tags are blanked, so offsets still point into the original.
      const masked = maskFences(text)
        .replace(/^---\r?\n[\s\S]*?\r?\n---/, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/!?\[\[[^\]\n]*\]\]/g, (m) => ' '.repeat(m.length))
        .replace(/(`+)[^`\n]*?\1/g, (m) => ' '.repeat(m.length))
        .replace(/\[[^\]\n]*\]\([^)\n]*\)/g, (m) => ' '.repeat(m.length))
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, (m) => ' '.repeat(m.length))
        .replace(/#[\p{L}\p{N}_\-/]+/gu, (m) => ' '.repeat(m.length));
      entry = { text, folded: foldText(masked) };
      cache?.set(source, entry);
    }
    const { folded } = entry;
    const lines = [];
    let line = 0;
    let scanned = 0;
    let lastLine = -1;
    for (const m of folded.matchAll(re)) {
      line += countBreaks(text, scanned, m.index);
      scanned = m.index;
      if (line === lastLine) continue;
      lastLine = line;
      const start = text.lastIndexOf('\n', m.index - 1) + 1;
      const nl = text.indexOf('\n', m.index);
      lines.push({ line, text: stripCR(text.slice(start, nl === -1 ? text.length : nl)), from: m.index - start, to: m.index - start + m[0].length });
    }
    if (lines.length) out.push({ source, lines });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

module.exports = { backlinksFor, foldText, searchVault, unlinkedMentions };
