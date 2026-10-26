'use strict';

// Fuzzy matching for the quick switcher and the command palette, like Obsidian's: the query's
// characters must appear in order; word starts and consecutive characters score higher. Spaces
// split the query into terms that may match in any order. Case and accents are ignored.

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The folded text keeps one character per original character (accents are combining marks that
// NFD splits off), so ranges map back to the original string.
function foldKeepingLength(text) {
  let out = '';
  for (const ch of text) {
    const f = fold(ch);
    out += f.length === ch.length ? f : ch.toLowerCase();
  }
  return out;
}

const isBoundary = (text, i) => i === 0 || /[\s_\-/.()[\]]/.test(text[i - 1])
  || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

function matchTerm(term, folded, original, used) {
  let best = null;
  // Try every start of the first character and keep the best-scoring greedy match.
  for (let start = folded.indexOf(term[0]); start !== -1; start = folded.indexOf(term[0], start + 1)) {
    let score = 0;
    let pos = start;
    const ranges = [];
    let ok = true;
    for (let k = 0; k < term.length; k++) {
      const at = k === 0 ? start : folded.indexOf(term[k], pos);
      if (at === -1) {
        ok = false;
        break;
      }
      if (used.has(at)) {
        ok = false;
        break;
      }
      const consecutive = k > 0 && at === pos;
      score += 1 + (isBoundary(original, at) ? 8 : 0) + (consecutive ? 5 : 0) - Math.min(at - pos, 10) * 0.1;
      const last = ranges[ranges.length - 1];
      if (last && last[1] === at) last[1] = at + 1;
      else ranges.push([at, at + 1]);
      pos = at + 1;
    }
    if (ok && (!best || score > best.score)) best = { score, ranges };
  }
  return best;
}

function fuzzyMatch(query, text) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, ranges: [] };
  const folded = foldKeepingLength(text);
  const used = new Set();
  let score = 0;
  const ranges = [];
  for (const term of terms) {
    const m = matchTerm(term, folded, text, used);
    if (!m) return null;
    score += m.score;
    for (const [a, b] of m.ranges) {
      for (let i = a; i < b; i++) used.add(i);
      ranges.push([a, b]);
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  // A match at the very start or the whole text is what the user most likely wants.
  if (ranges[0][0] === 0) score += 3;
  return { score: score - text.length * 0.01, ranges };
}

// [{item, score, ranges}] best first.
function fuzzySort(query, items, key) {
  const out = [];
  for (const item of items) {
    const m = fuzzyMatch(query, key(item));
    if (m) out.push({ item, ...m });
  }
  return out.sort((a, b) => b.score - a.score || key(a.item).length - key(b.item).length || key(a.item).localeCompare(key(b.item)));
}

module.exports = { fuzzyMatch, fuzzySort };
