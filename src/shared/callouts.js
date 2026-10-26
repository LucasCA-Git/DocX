'use strict';

// Obsidian callout types and their aliases → canonical type (colors/icons are keyed by it).
const ALIASES = {
  note: [], abstract: ['summary', 'tldr'], info: [], todo: [], tip: ['hint', 'important'], success: ['check', 'done'],
  question: ['help', 'faq'], warning: ['caution', 'attention'], failure: ['fail', 'missing'], danger: ['error'],
  bug: [], example: [], quote: ['cite'],
};
const CANONICAL = new Map();
for (const [type, aliases] of Object.entries(ALIASES)) for (const name of [type, ...aliases]) CANONICAL.set(name, type);

const calloutType = (name) => CANONICAL.get(String(name).toLowerCase()) ?? 'note';

// "> [!tip]+ Title" → { type, fold: '+'|'-'|'', marker: length of "> [!tip]+ " part to hide }.
const CALLOUT_RE = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)[ \t]*/;
function parseCalloutLine(line) {
  const m = line.match(CALLOUT_RE);
  if (!m) return null;
  return { type: calloutType(m[2]), name: m[2], fold: m[3], markerFrom: m[1].length, markerTo: m[0].length };
}

module.exports = { calloutType, parseCalloutLine };
