'use strict';

// Links made inside canvases, drawings and diagrams, so they show in the graph and in backlinks
// like the links of a note: canvas file cards and [[links]] in text cards, Excalidraw element links
// and [[links]] in its texts, draw.io cell links and [[links]] in its labels. Pure (renderer + tests).

const { parseLinks, isBoard } = require('./links');
const { diagramXmlFromFile, unescapeXml } = require('./drawio-file');
const { parseCanvas } = require('./canvas');

// A file from a remote with absurd amounts of links is cut here instead of slowing the graph.
const MAX_LINKS = 5000;
const DRAWIO_ATTR_RE = /\s(?:link|label|value)\s*=\s*"([^"]*)"/gi;

// Links found in `text`; from/to are 0 because they do not point into a note's text.
const linksIn = (text) => (typeof text === 'string' && text.includes('[[') ? parseLinks(text).map((l) => ({ ...l, from: 0, to: 0 })) : []);

function canvasLinks(text) {
  const out = [];
  for (const n of parseCanvas(text).nodes) {
    if (n.type === 'file') {
      const subpath = typeof n.subpath === 'string' ? n.subpath.replace(/^#/, '').trim() || null : null;
      out.push({ target: n.file, subpath, alias: null, embed: true, from: 0, to: 0 });
    } else if (n.type === 'text') {
      out.push(...linksIn(n.text));
    }
  }
  return out;
}

function excalidrawLinks(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || data.type !== 'excalidraw' || !Array.isArray(data.elements)) return [];
  const out = [];
  for (const element of data.elements) {
    if (!element || element.isDeleted) continue;
    out.push(...linksIn(element.link), ...(element.type === 'text' ? linksIn(element.text) : []));
  }
  return out;
}

// Compressed diagrams (old draw.io default) keep their XML deflated and are skipped.
function drawioLinks(text) {
  const xml = diagramXmlFromFile(text);
  const out = [];
  for (const match of xml.matchAll(DRAWIO_ATTR_RE)) out.push(...linksIn(unescapeXml(match[1])));
  return out;
}

function boardLinks(rel, text) {
  if (!isBoard(rel) || typeof text !== 'string') return [];
  let links;
  if (/\.canvas$/i.test(rel)) links = canvasLinks(text);
  else if (/\.excalidraw$/i.test(rel)) links = excalidrawLinks(text);
  else links = drawioLinks(text);
  return links.slice(0, MAX_LINKS);
}

module.exports = { boardLinks };
