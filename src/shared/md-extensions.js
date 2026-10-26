'use strict';

// Obsidian's Markdown additions for the Lezer parser (editor and Live Preview):
// ==highlight==, %%comment%% and $inline math$.

const { tags } = require('@lezer/highlight');

const PUNCTUATION = /[\p{S}\p{P}]/u;
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

const Highlight = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': tags.special(tags.content) } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [{
    name: 'Highlight',
    parse(cx, next, pos) {
      if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const before = cx.slice(pos - 1, pos);
      const after = cx.slice(pos + 2, pos + 3);
      const sBefore = /\s|^$/.test(before);
      const sAfter = /\s|^$/.test(after);
      const pBefore = PUNCTUATION.test(before);
      const pAfter = PUNCTUATION.test(after);
      return cx.addDelimiter(HighlightDelim, pos, pos + 2,
        !sAfter && (!pAfter || sBefore || pBefore),
        !sBefore && (!pBefore || sAfter || pAfter));
    },
    after: 'Emphasis',
  }],
};

// Scans to the closing delimiter on the same inline run; -1 when there is none.
function closing(cx, from, delim) {
  for (let i = from; i < cx.end; i++) {
    if (cx.char(i) === 92 /* \ */) {
      i++;
      continue;
    }
    if (cx.slice(i, i + delim.length) === delim) return i;
  }
  return -1;
}

const Comment = {
  defineNodes: [{ name: 'Comment', style: tags.comment }, { name: 'CommentMark', style: tags.processingInstruction }],
  parseInline: [{
    name: 'Comment',
    parse(cx, next, pos) {
      if (next !== 37 /* % */ || cx.char(pos + 1) !== 37) return -1;
      const end = closing(cx, pos + 2, '%%');
      if (end === -1) return -1;
      return cx.addElement(cx.elt('Comment', pos, end + 2, [cx.elt('CommentMark', pos, pos + 2), cx.elt('CommentMark', end, end + 2)]));
    },
    before: 'Emphasis',
  }],
};

// $x$: no space right after the opening or before the closing $, closing $ not followed by a
// digit (so "$5 e $10" stays text). $$ is block math, handled elsewhere.
const InlineMath = {
  defineNodes: [{ name: 'InlineMath', style: tags.special(tags.string) }, { name: 'InlineMathMark', style: tags.processingInstruction }],
  parseInline: [{
    name: 'InlineMath',
    parse(cx, next, pos) {
      if (next !== 36 /* $ */ || cx.char(pos + 1) === 36 || cx.char(pos - 1) === 36) return -1;
      if (/\s/.test(cx.slice(pos + 1, pos + 2)) || pos + 1 >= cx.end) return -1;
      for (let i = pos + 1; i < cx.end; i++) {
        const c = cx.char(i);
        if (c === 92) {
          i++;
          continue;
        }
        if (c === 10) return -1;
        if (c === 36) {
          if (/\s/.test(cx.slice(i - 1, i)) || /\d/.test(cx.slice(i + 1, i + 2)) || cx.char(i + 1) === 36) return -1;
          return cx.addElement(cx.elt('InlineMath', pos, i + 1, [cx.elt('InlineMathMark', pos, pos + 1), cx.elt('InlineMathMark', i, i + 1)]));
        }
      }
      return -1;
    },
    before: 'Emphasis',
  }],
};

const ObsidianMarkdown = [Highlight, Comment, InlineMath];

module.exports = { Highlight, Comment, InlineMath, ObsidianMarkdown };
