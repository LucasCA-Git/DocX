'use strict';

const { noteMetadata } = require('./metadata');

// Wikilinks ([[nota]], [[nota|apelido]], [[nota#título]]) and embeds (![[arquivo]]), resolved the
// way wiki-link editors do. Pure: shared by the renderer (bundled) and the tests (node --test).

const LINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const NOTE_RE = /\.(md|markdown)$/i;

const isNote = (rel) => NOTE_RE.test(rel);
const dirOf = (rel) => rel.split('/').slice(0, -1).join('/');
const blank = (text) => text.replace(/[^\n]/g, ' ');

// Blanks out fenced blocks (CommonMark rules: closing fence has no info string and is at least
// as long as the opening one).
function maskFences(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    if (fence) {
      const close = line.match(FENCE_CLOSE_RE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return blank(line);
    }
    const open = line.match(FENCE_OPEN_RE);
    if (open) {
      fence = open[1];
      return blank(line);
    }
    return line;
  }).join('\n');
}

// Blanks out inline code: a run of N backticks up to the next run of exactly N backticks in the
// same paragraph. An unmatched run is literal text.
function maskInlineCode(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      out += text[i++];
      continue;
    }
    let n = i;
    while (text[n] === '`') n++;
    const run = n - i;
    const paragraphEnd = text.slice(n).search(/\n[ \t]*\n/);
    const limit = paragraphEnd === -1 ? text.length : n + paragraphEnd;
    let close = -1;
    for (let j = n; j < limit; j++) {
      if (text[j] !== '`') continue;
      let k = j;
      while (text[k] === '`') k++;
      if (k - j === run) {
        close = k;
        break;
      }
      j = k - 1;
    }
    if (close === -1) {
      out += text.slice(i, n);
      i = n;
    } else {
      out += blank(text.slice(i, close));
      i = close;
    }
  }
  return out;
}

function parseLinks(text) {
  const out = [];
  for (const match of maskInlineCode(maskFences(text)).matchAll(LINK_RE)) {
    const inner = match[2];
    const bar = inner.indexOf('|');
    // Inside tables the alias pipe is written escaped: [[nota\|apelido]].
    let ref = bar === -1 ? inner : inner.slice(0, bar);
    if (bar !== -1 && ref.endsWith('\\')) ref = ref.slice(0, -1);
    const hash = ref.indexOf('#');
    const target = (hash === -1 ? ref : ref.slice(0, hash)).trim();
    const subpath = hash === -1 ? null : ref.slice(hash + 1).trim() || null;
    if (!target && !subpath) continue;
    out.push({
      target,
      subpath,
      alias: bar === -1 ? null : inner.slice(bar + 1).trim() || null,
      embed: match[1] === '!',
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return out;
}

// The link whose [[ ]] contains position `pos` (code spans and blocks excluded), or null.
function linkAt(text, pos) {
  return parseLinks(text).find((link) => pos >= link.from && pos < link.to) ?? null;
}

// Case-insensitive lookup tables; a note answers to its path with or without ".md". `suffixes`
// maps every trailing part of a path ("b/c", "c") to the files ending in it.
function createLookup(files) {
  const paths = new Map();
  const suffixes = new Map();
  for (const rel of files) {
    const lower = rel.toLowerCase();
    const keys = isNote(rel) ? [lower, lower.replace(NOTE_RE, '')] : [lower];
    for (const key of keys) {
      if (!paths.has(key)) paths.set(key, rel);
      const parts = key.split('/');
      for (let i = 0; i < parts.length; i++) {
        const suffix = parts.slice(i).join('/');
        if (!suffixes.has(suffix)) suffixes.set(suffix, new Set());
        suffixes.get(suffix).add(rel);
      }
    }
  }
  return { files, paths, suffixes };
}

const depth = (rel) => rel.split('/').length;
const closest = (candidates) => [...candidates].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0] ?? null;

// "./x" and "../x" against the source folder; null when it climbs above the vault root.
function joinRelative(dir, key) {
  const parts = dir ? dir.split('/') : [];
  for (const seg of key.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg !== '.' && seg !== '') {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

// Order: relative to the source note's folder, then from the vault root, then by name or partial
// path anywhere (shortest path wins when names repeat).
function resolveLink(target, filesOrLookup, sourcePath = null) {
  const lookup = Array.isArray(filesOrLookup) ? createLookup(filesOrLookup) : filesOrLookup;
  const key = target.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!key) return sourcePath;

  const dir = sourcePath ? dirOf(sourcePath).toLowerCase() : '';
  if (key.startsWith('./') || key.startsWith('../')) {
    const joined = joinRelative(dir, key);
    return joined ? lookup.paths.get(joined) ?? null : null;
  }
  if (dir && lookup.paths.has(`${dir}/${key}`)) return lookup.paths.get(`${dir}/${key}`);
  if (lookup.paths.has(key)) return lookup.paths.get(key);
  return closest(lookup.suffixes.get(key) ?? []);
}

const edgeKey = (a, b) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

// Links of every note, kept up to date with update()/remove(). Editing a note re-resolves only
// that note; changing the file list re-resolves everything (a new file can satisfy old links).
class LinkIndex {
  constructor() {
    this.files = [];
    this.fileSet = new Set();
    this.lookup = createLookup([]);
    this.raw = new Map();
    // path -> { frontmatter, tags, aliases, headings, blocks } (see metadata.js)
    this.meta = new Map();
    this.resolvedBySource = new Map();
    this.graphCache = null;
  }

  // The same list again (every vault refresh) keeps the resolved links; any change re-resolves.
  setFiles(files) {
    if (files.length === this.files.length && files.every((f) => this.fileSet.has(f))) return;
    this.files = [...files];
    this.fileSet = new Set(this.files);
    this.lookup = createLookup(this.files);
    for (const rel of this.raw.keys()) if (!this.fileSet.has(rel)) this.raw.delete(rel);
    for (const rel of this.meta.keys()) if (!this.fileSet.has(rel)) this.meta.delete(rel);
    this.resolvedBySource.clear();
    this.graphCache = null;
  }

  update(rel, text) {
    if (!this.fileSet.has(rel)) this.setFiles([...this.files, rel]);
    this.raw.set(rel, parseLinks(text));
    this.meta.set(rel, noteMetadata(text));
    this.resolvedBySource.delete(rel);
    this.graphCache = null;
  }

  remove(rel) {
    this.setFiles(this.files.filter((f) => f !== rel));
  }

  resolved() {
    for (const [source, links] of this.raw) {
      if (this.resolvedBySource.has(source)) continue;
      this.resolvedBySource.set(source, links.map((link) => ({ ...link, resolved: resolveLink(link.target, this.lookup, source) })));
    }
    return this.resolvedBySource;
  }

  metadata(rel) {
    return this.meta.get(rel) ?? null;
  }

  tagsOf(rel) {
    return this.meta.get(rel)?.tags ?? [];
  }

  // [{ tag, count }] over every note; tags differing only in case are one tag (first spelling).
  tagCounts() {
    const counts = new Map();
    for (const { tags } of this.meta.values()) {
      for (const tag of tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key) ?? { tag, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  }

  // path -> aliases, only notes that declare some.
  get aliases() {
    const out = new Map();
    for (const [rel, { aliases }] of this.meta) if (aliases.length) out.set(rel, aliases);
    return out;
  }

  outgoing(rel) {
    return this.resolved().get(rel) ?? [];
  }

  resolve(target, sourcePath = null) {
    return resolveLink(target, this.lookup, sourcePath);
  }

  backlinks(rel) {
    const sources = [];
    for (const [source, links] of this.resolved()) {
      if (source !== rel && links.some((l) => l.resolved === rel)) sources.push(source);
    }
    return sources.sort();
  }

  unresolvedTargets() {
    const seen = new Map();
    for (const links of this.resolved().values()) {
      for (const l of links) if (!l.resolved && l.target && !seen.has(l.target.toLowerCase())) seen.set(l.target.toLowerCase(), l.target);
    }
    return [...seen.values()].sort();
  }

  // Undirected graph: nodes {id, type: 'note'|'attachment'|'unresolved'}, edges {source, target}.
  graph({ includeUnresolved = false } = {}) {
    if (this.graphCache?.includeUnresolved === includeUnresolved) return this.graphCache.result;
    const nodes = this.files.map((id) => ({ id, type: isNote(id) ? 'note' : 'attachment' }));
    const unresolved = new Map();
    const edges = new Map();
    for (const [source, links] of this.resolved()) {
      for (const link of links) {
        let target = link.resolved;
        if (!target) {
          if (!includeUnresolved || !link.target) continue;
          const key = link.target.toLowerCase();
          if (!unresolved.has(key)) unresolved.set(key, link.target);
          target = unresolved.get(key);
        }
        if (target === source) continue;
        const key = edgeKey(source, target);
        if (!edges.has(key)) edges.set(key, { source, target });
      }
    }
    for (const id of unresolved.values()) nodes.push({ id, type: 'unresolved' });

    const neighbours = new Map();
    for (const { source, target } of edges.values()) {
      if (!neighbours.has(source)) neighbours.set(source, new Set());
      if (!neighbours.has(target)) neighbours.set(target, new Set());
      neighbours.get(source).add(target);
      neighbours.get(target).add(source);
    }
    const result = { nodes, edges: [...edges.values()], neighbours };
    this.graphCache = { includeUnresolved, result };
    return result;
  }

  localGraph(rel, { depth: maxDepth = 1, includeUnresolved = false } = {}) {
    const { nodes, edges, neighbours } = this.graph({ includeUnresolved });
    const keep = new Set([rel]);
    let frontier = [rel];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next = new Set();
      for (const id of frontier) for (const n of neighbours.get(id) ?? []) if (!keep.has(n)) next.add(n);
      for (const id of next) keep.add(id);
      frontier = [...next];
    }
    return {
      nodes: nodes.filter((n) => keep.has(n.id)),
      edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }
}

module.exports = { maskFences, parseLinks, linkAt, resolveLink, createLookup, LinkIndex, isNote };
