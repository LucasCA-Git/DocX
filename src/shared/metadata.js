'use strict';

// What a note declares besides links: YAML front matter (properties, tags, aliases), #tags,
// headings and ^block ids. Pure, shared by the renderer and the tests.

const FRONT_MATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?=\r?\n|$)/;
// Fences also inside list items and blockquotes.
const FENCE_RE = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(`{3,}|~{3,})/;

// One YAML scalar: quoted strings, numbers, booleans, null, [inline, arrays]; anything else stays
// a string (dates included).
function scalar(raw) {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^".*"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return (inner.match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g) ?? []).map((item) => scalar(item)).filter((x) => x !== null);
  }
  return v.replace(/\s+#.*$/, '');
}

// {data (null when there is no front matter), from, to (end of the closing ---), bodyLine}.
// A small YAML subset: "key: value", "key:" followed by "- item" lines, comments. Nested maps
// are kept as their raw text.
function parseFrontMatter(text) {
  const match = text.match(FRONT_MATTER_RE);
  if (!match) return { data: null, from: 0, to: 0, bodyLine: 0 };
  const data = {};
  let listKey = null;
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // Not YAML (e.g. a note starting with a --- rule and a paragraph): no front matter.
    if (!/^\s*-\s/.test(line) && !/^\s*-$/.test(line) && !/^[^\s:#][^:]*?\s*:(\s|$)/.test(line) && !(listKey && /^\s/.test(line))) {
      return { data: null, from: 0, to: 0, bodyLine: 0 };
    }
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      const value = scalar(item[1]);
      if (value !== null) data[listKey].push(value);
      continue;
    }
    const pair = line.match(/^([^\s:#][^:]*?)\s*:(?:\s+(.*)|\s*)$/);
    if (pair && !/^\s/.test(line)) {
      listKey = pair[1].trim();
      if (listKey === '__proto__') {
        listKey = null;
        continue;
      }
      data[listKey] = scalar(pair[2] ?? '');
    } else if (listKey && /^\s/.test(line)) {
      const prev = data[listKey];
      data[listKey] = `${prev === null ? '' : `${prev}\n`}${line.trim()}`;
    }
  }
  const to = match[0].length;
  return { data, from: 0, to, bodyLine: match[0].split('\n').length };
}

// Lines inside fenced code (and the front matter) are not markdown.
function textLines(text) {
  const lines = text.split('\n');
  const fm = parseFrontMatter(text);
  const out = [];
  let fence = null;
  let offset = 0;
  lines.forEach((line, i) => {
    const raw = line.replace(/\r$/, '');
    const start = offset;
    offset += line.length + 1;
    if (i < fm.bodyLine) return;
    const open = raw.match(FENCE_RE);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !raw.slice(open[0].length).trim()) fence = null;
      return;
    }
    if (open) {
      fence = open[1];
      return;
    }
    out.push({ text: raw, line: i, from: start });
  });
  return out;
}

const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

// Inline #tags: [{tag (without #), from, to}]. Not in code, links, URLs or headings' "# ".
function parseTags(text) {
  const out = [];
  for (const { text: line, from } of textLines(text)) {
    // Inline code, wikilinks and URLs blanked so their "#" is not a tag.
    const masked = line
      .replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))
      .replace(/\[\[[^\]]*\]\]/g, (m) => ' '.repeat(m.length))
      .replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, (m) => ' '.repeat(m.length));
    for (const m of masked.matchAll(TAG_RE)) {
      const start = m.index + m[1].length;
      const tag = m[2].replace(/[/-]+$/, '');
      if (!tag || !/[\p{L}_]/u.test(tag)) continue;
      out.push({ tag, from: from + start, to: from + start + 1 + tag.length });
    }
  }
  return out;
}

function parseHeadings(text) {
  const out = [];
  const lines = textLines(text);
  lines.forEach(({ text: line, line: n }, i) => {
    const atx = line.match(/^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/);
    if (atx) {
      out.push({ level: atx[1].length, text: atx[2].trim(), line: n });
      return;
    }
    const next = lines[i + 1];
    if (line.trim() && next && next.line === n + 1 && /^ {0,3}(=+|-+)[ \t]*$/.test(next.text) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      out.push({ level: next.text.trim()[0] === '=' ? 1 : 2, text: line.trim(), line: n });
    }
  });
  return out;
}

function parseBlockIds(text) {
  const out = [];
  for (const { text: line, line: n } of textLines(text)) {
    const m = line.match(/\s\^([A-Za-z0-9-]+)\s*$/);
    if (m) out.push({ id: m[1], line: n });
  }
  return out;
}

const asList = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value).split(/[,\s]+/).filter(Boolean);
};

function noteMetadata(text) {
  const { data } = parseFrontMatter(text);
  const fm = data ?? {};
  const tags = [];
  const seen = new Set();
  const addTag = (tag) => {
    const clean = tag.replace(/^#/, '');
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      tags.push(clean);
    }
  };
  asList(fm.tags ?? fm.tag).forEach(addTag);
  parseTags(text).forEach((t) => addTag(t.tag));
  const aliasValue = fm.aliases ?? fm.alias;
  const aliases = Array.isArray(aliasValue) ? aliasValue.map(String) : aliasValue ? [String(aliasValue)] : [];
  return { frontmatter: data, tags, aliases, headings: parseHeadings(text), blocks: parseBlockIds(text) };
}

const plain = (text) => text.replace(/[*_`~=[\]]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// Line of "#Heading", "#Parent#Child" (the last part decides) or "#^block" in a note, or null.
function subpathLine(meta, subpath) {
  if (!meta || !subpath) return null;
  if (subpath.startsWith('^')) return meta.blocks.find((b) => b.id === subpath.slice(1))?.line ?? null;
  const want = plain(subpath.split('#').filter(Boolean).pop() ?? '');
  return meta.headings.find((h) => plain(h.text) === want)?.line ?? null;
}

// The text a ![[note#subpath]] embed shows: the whole note (without front matter), a heading's
// section (up to the next heading of the same or a higher level) or a block's paragraph / list
// item. null when the heading or block is not there.
function sectionText(text, subpath) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const fm = parseFrontMatter(text);
  if (!subpath) return lines.slice(fm.bodyLine).join('\n').replace(/^\n+/, '');
  const meta = { headings: parseHeadings(text), blocks: parseBlockIds(text) };
  const line = subpathLine(meta, subpath);
  if (line === null) return null;
  if (subpath.startsWith('^')) {
    const strip = (l) => l.replace(/\s\^[A-Za-z0-9-]+\s*$/, '');
    if (/^\s*([-*+]|\d+[.)])\s/.test(lines[line])) return strip(lines[line]);
    let start = line;
    while (start > fm.bodyLine && lines[start - 1].trim() && !/^#{1,6}\s/.test(lines[start - 1])) start--;
    return lines.slice(start, line + 1).map((l, i, all) => (i === all.length - 1 ? strip(l) : l)).join('\n');
  }
  const heading = meta.headings.find((h) => h.line === line);
  const next = meta.headings.find((h) => h.line > line && h.level <= heading.level);
  return lines.slice(line, next ? next.line : lines.length).join('\n').replace(/\n+$/, '');
}

module.exports = { sectionText, subpathLine, parseFrontMatter, parseTags, parseHeadings, parseBlockIds, noteMetadata, textLines };
