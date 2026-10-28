'use strict';

// Diagram files. "x.drawio" holds draw.io's <mxfile> XML. "x.drawio.svg" (the default) is a normal
// SVG picture with that XML in its root's content attribute: one file that draw.io edits and that
// notes, GitHub and any viewer show as an image.

const DRAWIO_RE = /\.drawio(\.svg)?$/i;
const DRAWIO_SVG_RE = /\.drawio\.svg$/i;

const isDrawioPath = (path) => DRAWIO_RE.test(path);
const isDrawioSvg = (path) => DRAWIO_SVG_RE.test(path);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

const escapeAttr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\n/g, '&#xa;');

// What draw.io's "load" action takes: the <mxfile> XML ('' for a new, empty diagram).
function diagramXmlFromFile(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!/^(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<svg\b/i.test(trimmed)) return text;
  const root = trimmed.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const attr = root.match(/\scontent\s*=\s*("([^"]*)"|'([^']*)')/i);
  return attr ? unescapeXml(attr[2] ?? attr[3]) : '';
}

// The SVG text of draw.io's export (a data: URL in base64 or percent-encoding).
function svgFromExportData(data) {
  if (typeof data !== 'string') throw new Error('Exportação do diagrama inválida (SVG esperado)');
  if (!data.startsWith('data:')) {
    if (/^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<svg\b/i.test(data)) return data;
    throw new Error('Exportação do diagrama inválida (SVG esperado)');
  }
  const comma = data.indexOf(',');
  const header = data.slice(5, comma);
  if (comma < 0 || !/^image\/svg\+xml(;|$)/i.test(header)) throw new Error('Exportação do diagrama inválida (SVG esperado)');
  const body = data.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    const binary = atob(body);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }
  return decodeURIComponent(body);
}

// An editable SVG without a picture, for when the editor is gone before it could export one: the
// diagram is kept and the picture comes back the next time it is saved from the editor.
function fallbackSvg(xml) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1px" height="1px" viewBox="0 0 1 1" content="${escapeAttr(xml)}"></svg>`;
}

// The last exported picture with a newer diagram in it (the picture catches up on the next save).
function withDiagramXml(svgText, xml) {
  const root = svgText.match(/<svg\b[^>]*>/i);
  if (!root) return fallbackSvg(xml);
  const attr = ` content="${escapeAttr(xml)}"`;
  const tag = /\scontent\s*=\s*("[^"]*"|'[^']*')/i.test(root[0])
    ? root[0].replace(/\scontent\s*=\s*("[^"]*"|'[^']*')/i, () => attr)
    : root[0].replace(/^<svg\b/i, () => `<svg${attr}`);
  return svgText.slice(0, root.index) + tag + svgText.slice(root.index + root[0].length);
}

module.exports = { isDrawioPath, isDrawioSvg, unescapeXml, diagramXmlFromFile, svgFromExportData, fallbackSvg, withDiagramXml };
