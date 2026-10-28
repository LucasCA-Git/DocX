'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

let tmpCounter = 0;

// Notes, plus canvases, drawings and diagrams (read for the links inside them).
const TEXT_NOTE_RE = /\.(md|markdown|txt|canvas|excalidraw|drawio|drawio\.svg)$/i;
const MAX_NOTE_BYTES = 5 * 1024 * 1024;
const READ_BATCH = 64;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Dotfiles/dot-folders (.docs-sync, .trash, .git, temp files) and node_modules never sync.
function isIgnored(rel) {
  return rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules');
}

// User-chosen names: a leading dot would hide the item from the app and from the sync.
function assertVisible(rel) {
  if (typeof rel === 'string' && rel.split('/').some((seg) => seg.startsWith('.'))) {
    throw new Error('Nomes não podem começar com "."');
  }
}

// Local folder of notes. Every path crossing this API is relative, POSIX-style ("pasta/nota.md").
class Vault {
  constructor(root) {
    this.root = path.resolve(root);
  }

  resolve(rel) {
    if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) {
      throw new Error('Caminho inválido');
    }
    const full = path.resolve(this.root, rel);
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error('Caminho fora do vault');
    }
    return full;
  }

  toRel(full) {
    return path.relative(this.root, full).split(path.sep).join('/');
  }

  async walk() {
    return (await this.listTree()).files;
  }

  // Folders are listed too so empty ones still show in the explorer.
  // withTimes adds times: { rel: [modified ms, created ms] } for sorting the explorer.
  async listTree({ withTimes = false } = {}) {
    const files = [];
    const folders = [];
    const times = withTimes ? {} : undefined;
    const visit = async (dir) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = this.toRel(full);
        if (isIgnored(rel)) continue;
        if (entry.isDirectory()) {
          folders.push(rel);
          await visit(full);
        } else if (entry.isFile()) {
          files.push(rel);
          if (times) {
            const st = await fsp.stat(full).catch(() => null);
            if (st) times[rel] = [st.mtimeMs, st.birthtimeMs || st.ctimeMs];
          }
        }
      }
    };
    await visit(this.root);
    return { files: files.sort(), folders: folders.sort(), ...(times ? { times } : {}) };
  }

  async mkdir(rel) {
    const full = this.resolve(rel);
    assertVisible(rel);
    if (fs.existsSync(full)) throw new Error(`"${rel}" já existe`);
    await fsp.mkdir(full, { recursive: true });
  }

  // hints: last known {hash, mtimeMs, size} per path, so unchanged files are not re-hashed.
  async listFiles(hints = {}) {
    const out = new Map();
    for (const rel of await this.walk()) {
      const info = await this.fileInfo(rel, hints[rel]);
      if (info) out.set(rel, info);
    }
    return out;
  }

  async fileInfo(rel, hint) {
    const full = this.resolve(rel);
    let st;
    try {
      st = await fsp.stat(full);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
    if (!st.isFile()) return null;
    if (hint && hint.mtimeMs === st.mtimeMs && hint.size === st.size) {
      return { hash: hint.hash, mtimeMs: st.mtimeMs, size: st.size };
    }
    const body = await fsp.readFile(full);
    return { hash: sha256(body), mtimeMs: st.mtimeMs, size: st.size };
  }

  async isDirectory(rel) {
    try {
      return (await fsp.stat(this.resolve(rel))).isDirectory();
    } catch {
      return false;
    }
  }

  read(rel) {
    return fsp.readFile(this.resolve(rel));
  }

  // Several notes at once (the renderer's link index loads every note on start); null where a file
  // is missing, is not a text note, is larger than maxBytes or the path is invalid. Read in small
  // batches so a big vault does not open thousands of files at once.
  async readTexts(rels, { maxBytes = MAX_NOTE_BYTES } = {}) {
    const readOne = async (rel) => {
      if (!TEXT_NOTE_RE.test(rel)) return null;
      try {
        const full = this.resolve(rel);
        if ((await fsp.stat(full)).size > maxBytes) return null;
        return (await fsp.readFile(full)).toString('utf8');
      } catch {
        return null;
      }
    };
    const out = [];
    for (let i = 0; i < rels.length; i += READ_BATCH) {
      out.push(...await Promise.all(rels.slice(i, i + READ_BATCH).map(readOne)));
    }
    return out;
  }

  // Stat before reading: if the file changes in between, the stored mtime is stale and forces a re-hash.
  async readWithStat(rel) {
    const full = this.resolve(rel);
    const st = await fsp.stat(full);
    const body = await fsp.readFile(full);
    return { body, mtimeMs: st.mtimeMs, size: st.size };
  }

  // Atomic write (temp dotfile + rename) so a crash never leaves a half-written note.
  async write(rel, data) {
    const full = this.resolve(rel);
    const dir = path.dirname(full);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(full)}.${process.pid}-${++tmpCounter}.docs-tmp`);
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, full);
    const st = await fsp.stat(full);
    return { mtimeMs: st.mtimeMs, size: st.size };
  }

  async create(rel, data = '') {
    const full = this.resolve(rel);
    assertVisible(rel);
    if (fs.existsSync(full)) throw new Error(`"${rel}" já existe`);
    return this.write(rel, data);
  }

  async rename(from, to) {
    const src = this.resolve(from);
    const dest = this.resolve(to);
    assertVisible(to);
    // On Windows "nota" and "Nota" are the same file: a case-only rename is not a clash.
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    if (!caseOnly && fs.existsSync(dest)) throw new Error(`"${to}" já existe`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (caseOnly) {
      const tmp = `${src}.docs-rename-${Date.now()}`;
      await fsp.rename(src, tmp);
      await fsp.rename(tmp, dest);
    } else {
      await fsp.rename(src, dest);
    }
  }

  async copy(from, to) {
    const src = this.resolve(from);
    const dest = this.resolve(to);
    assertVisible(to);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code === 'EEXIST') throw new Error(`"${to}" já existe`);
      throw err;
    }
  }

  // Deleted notes go to <vault>/.trash instead of disappearing.
  async trash(rel) {
    const src = this.resolve(rel);
    let dest = path.join(this.root, '.trash', ...rel.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) dest = `${dest}.${Date.now()}`;
    await fsp.rename(src, dest);
  }

  watch(onChange) {
    const watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString().split(path.sep).join('/');
      if (!isIgnored(rel)) onChange(rel);
    });
    watcher.on('error', () => {});
    return () => watcher.close();
  }
}

module.exports = { Vault, isIgnored, sha256 };
