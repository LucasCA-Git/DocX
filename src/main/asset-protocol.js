'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isIgnored } = require('./vault');
const { assetPathFromUrl } = require('../shared/asset-url');

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  // Audio and video embeds (![[gravação.mp3]]).
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};
const IMAGE_RE = new RegExp(`\\.(${Object.keys(TYPES).join('|')})$`, 'i');

// Absolute path of the image/media file a vault-asset:// URL names, or null. Only visible image files whose
// real location (after following links and Windows short names like TRASH~1) is inside the vault
// are served.
async function resolveAsset(vault, url) {
  if (!vault) return null;
  const rel = assetPathFromUrl(url);
  if (!rel || !IMAGE_RE.test(rel) || isIgnored(rel)) return null;
  try {
    const full = vault.resolve(rel);
    const [real, root] = await Promise.all([fs.realpath(full), fs.realpath(vault.root)]);
    const relative = path.relative(root, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const realRel = relative.split(path.sep).join('/');
    if (isIgnored(realRel) || !IMAGE_RE.test(realRel)) return null;
    if (!(await fs.stat(real)).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

// Response headers: the type comes from the extension (never sniffed), and an SVG opened by any
// means cannot run scripts or load anything.
function assetHeaders(file) {
  const ext = file.match(IMAGE_RE)[1].toLowerCase();
  return {
    'Content-Type': TYPES[ext],
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
}

module.exports = { resolveAsset, assetHeaders, IMAGE_RE };
