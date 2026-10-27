'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// The diagram editor (draw.io webapp, Apache-2.0) is served from the app's own files under a
// scheme of its own: a separate origin, so the editor in its iframe cannot reach the app window,
// the preload API or the vault. The app talks to it only through postMessage.
const { DRAWIO_SCHEME, DRAWIO_HOST, DRAWIO_ORIGIN, drawioEditorUrl } = require('../shared/drawio');

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  wasm: 'application/wasm',
};

// draw.io needs inline scripts and eval (stencils, plugins); that is confined to this origin, which
// may load nothing from anywhere else and may only be framed by the app window.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors file: 'self'",
].join('; ');

// Absolute path of the file a docx-drawio:// URL names inside `root`, or null.
async function resolveDrawioFile(root, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${DRAWIO_SCHEME}:` || parsed.host !== DRAWIO_HOST) return null;
  const segments = [];
  for (const raw of parsed.pathname.split('/')) {
    if (!raw) continue;
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (seg === '.' || seg === '..' || /[\\/:\0]/.test(seg)) return null;
    segments.push(seg);
  }
  if (!segments.length) segments.push('index.html');
  const full = path.join(root, ...segments);
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return (await fs.stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

function drawioHeaders(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
  };
}

module.exports = { DRAWIO_SCHEME, DRAWIO_ORIGIN, drawioEditorUrl, resolveDrawioFile, drawioHeaders };
