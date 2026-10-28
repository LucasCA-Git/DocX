import { LinkIndex, isNote, isBoard } from '../shared/links';
import { boardLinks } from '../shared/file-links';

const api = window.docs;

// The renderer's view of the vault: file/folder lists and the link index of every note, canvas,
// drawing and diagram.
// Emits 'change' (files or links changed) and 'links' (one note's links changed by a save).
export class VaultStore extends EventTarget {
  constructor() {
    super();
    this.files = [];
    this.folders = [];
    this.times = {};
    this.index = new LinkIndex();
    this.generation = 0;
    // Bumped whenever a note's text changes (embeds showing it re-render).
    this.version = 0;
    this.pendingChanged = new Set();
    // Text of every note, for backlink lines and search.
    this.texts = new Map();
  }

  // Concurrent refreshes can answer out of order; only the latest request is applied. Notes and
  // boards not indexed yet, and the changed ones, are read so the index (and the graph) knows their
  // links. Only note texts are kept (boards are JSON/XML, not text to search or quote).
  // Changed paths wait in `pendingChanged` until a refresh applies them, so a newer refresh that
  // supersedes this one still re-reads them.
  async refresh(changed = []) {
    for (const rel of changed) this.pendingChanged.add(rel);
    const generation = ++this.generation;
    const { files, folders, times = {} } = await api.list();
    if (generation !== this.generation) return;
    const pending = new Set(this.pendingChanged);
    const indexed = this.index.raw;
    const stale = files.filter((f) => (isNote(f) || isBoard(f)) && (!indexed.has(f) || pending.has(f)));
    const texts = stale.length ? await api.readTexts(stale) : [];
    if (generation !== this.generation) return;
    for (const rel of pending) this.pendingChanged.delete(rel);
    this.index.setFiles(files);
    const present = new Set(files);
    for (const rel of this.texts.keys()) if (!present.has(rel)) this.texts.delete(rel);
    stale.forEach((rel, i) => {
      if (texts[i] === null) return;
      if (isBoard(rel)) {
        this.index.updateLinks(rel, boardLinks(rel, texts[i]));
        return;
      }
      this.index.update(rel, texts[i]);
      this.texts.set(rel, texts[i]);
    });
    this.version++;
    this.files = files;
    this.folders = folders;
    this.times = times;
    this.dispatchEvent(new Event('change'));
  }

  // A note was saved from the editor.
  updateNote(rel, text) {
    this.version++;
    this.index.update(rel, text);
    this.texts.set(rel, text);
    this.dispatchEvent(new Event('links'));
  }

  has(rel) {
    return this.files.includes(rel);
  }

  resolve(target, sourcePath) {
    return this.index.resolve(target, sourcePath);
  }
}
