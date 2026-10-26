'use strict';

// Line diff for the version history: [{type: 'equal'|'removed'|'added', text}]. LCS over the part
// between the common prefix and suffix; when that part is too big for the table, the middle is
// shown as all removed + all added instead of freezing the window.
const MAX_CELLS = 4_000_000;

function diffLines(oldText, newText) {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  if (oldText === '') a.length = 0;
  if (newText === '') b.length = 0;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out = a.slice(0, start).map((text) => ({ type: 'equal', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    out.push(...midA.map((text) => ({ type: 'removed', text })), ...midB.map((text) => ({ type: 'added', text })));
  } else {
    // lcs[i][j] = LCS length of midA[i..] and midB[j..], in one flat array.
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ type: 'equal', text: midA[i++] });
        j++;
      } else if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
        if (i < n && lcs[(i + 1) * w + j] === lcs[i * w + j + 1]) out.push({ type: 'removed', text: midA[i++] });
        else out.push({ type: 'added', text: midB[j++] });
      } else {
        out.push({ type: 'removed', text: midA[i++] });
      }
    }
  }
  out.push(...a.slice(endA).map((text) => ({ type: 'equal', text })));
  return out;
}

module.exports = { diffLines };
