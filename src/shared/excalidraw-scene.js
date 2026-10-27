'use strict';

// A .excalidraw file → the scene given to the drawing editor and to exportToSvg. Files can come
// from a Git remote, so anything that would make the editor load web content inside the app window
// is dropped: "iframe" and "embeddable" elements (they render HTML/web pages in frames), images that
// are not embedded data, and element links other than [[notes]] and web pages.

const FRAME_TYPES = new Set(['iframe', 'embeddable']);
const LINK_RE = /^(\[\[[^\]]+\]\]|https?:\/\/\S+)$/i;

function cleanElement(element) {
  if (!element || typeof element !== 'object' || FRAME_TYPES.has(element.type)) return null;
  if (element.link == null) return element;
  const ok = typeof element.link === 'string' && LINK_RE.test(element.link.trim());
  return ok ? element : { ...element, link: null };
}

function cleanFiles(files) {
  const out = {};
  if (!files || typeof files !== 'object') return out;
  for (const [id, file] of Object.entries(files)) {
    if (file && typeof file === 'object' && typeof file.dataURL === 'string' && file.dataURL.startsWith('data:image/')) out[id] = file;
  }
  return out;
}

function parseScene(text) {
  const data = text.trim() ? JSON.parse(text) : {};
  if (data.type && data.type !== 'excalidraw') throw new Error('O arquivo não é um desenho do Excalidraw');
  return {
    elements: Array.isArray(data.elements) ? data.elements.map(cleanElement).filter(Boolean) : [],
    appState: data.appState && typeof data.appState === 'object' && !Array.isArray(data.appState) ? data.appState : {},
    files: cleanFiles(data.files),
  };
}

module.exports = { parseScene };
