'use strict';

// URLs for vault attachments shown in the renderer (images in ![[ ]]). The main process serves
// this scheme; the renderer never touches the file system.

const ASSET_SCHEME = 'vault-asset';
const PREFIX = `${ASSET_SCHEME}://local/`;

function assetUrl(rel) {
  return PREFIX + rel.split('/').map(encodeURIComponent).join('/');
}

// Relative POSIX path, or null for anything that is not a plain path inside the vault.
function assetPathFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) return null;
  const segments = url.slice(PREFIX.length).replace(/[?#].*$/, '').split('/');
  const out = [];
  for (const raw of segments) {
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // Separators, NUL, and characters Windows reads specially (":" opens alternate data streams).
    if (!seg || seg === '.' || seg === '..' || /[\\/\0:<>"|?*]/.test(seg)) return null;
    out.push(seg);
  }
  return out.join('/');
}

module.exports = { ASSET_SCHEME, assetUrl, assetPathFromUrl };
