import { el, displayName, errorText } from '../dom';
import { notice, renderDocStats } from '../status';
import { isLightTheme } from '../appearance';

const api = window.docs;
const SAVE_DELAY_MS = 800;
const LIBRARY_KEY = 'docx.excalidraw.library';

let ready = null;

// The drawing editor bundle (vendor/excalidraw) is loaded once, the first time it is needed.
export function loadExcalidraw() {
  ready ??= new Promise((resolve, reject) => {
    window.EXCALIDRAW_ASSET_PATH = new URL('vendor/excalidraw/', window.location.href).href;
    document.head.append(el('link', { rel: 'stylesheet', href: 'vendor/excalidraw/excalidraw.css' }));
    const script = el('script', { src: 'vendor/excalidraw/excalidraw.js' });
    script.addEventListener('load', () => resolve(window.DocxExcalidraw));
    script.addEventListener('error', () => {
      ready = null;
      reject(new Error('Não foi possível carregar o editor de desenho'));
    });
    document.head.append(script);
  });
  return ready;
}

function loadLibrary() {
  try {
    const items = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveLibrary(items) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
  } catch {
    // storage full or unavailable: the library lasts until the app closes
  }
}

const themeName = () => (isLightTheme() ? 'light' : 'dark');

// A .excalidraw file in the Excalidraw editor (the same one as excalidraw.com): hand-drawn shapes,
// arrows, text, images, libraries. Saved as the standard JSON, which opens on excalidraw.com too.
export class ExcalidrawView {
  constructor({ workspace, store, path }) {
    this.workspace = workspace;
    this.store = store;
    this.path = path;
    this.dirty = false;
    this.pending = null;
    this.lastSaved = null;
    this.saving = Promise.resolve(true);
    this.editor = null;

    this.host = el('div', { class: 'excalidraw-host' });
    this.titleEl = el('span', { class: 'view-header-title-text' });
    this.el = el('div', { class: 'view excalidraw-view' },
      el('div', { class: 'view-header' }, el('div', { class: 'view-header-title' }, this.titleEl)),
      el('div', { class: 'view-content excalidraw-content' }, this.host));
    this.el.dataset.sourcePath = path;
    this.titleEl.textContent = this.title;
    // The app theme (light/dark/system) is a class on <body>.
    this.themeObserver = new MutationObserver(() => this.editor?.setTheme(themeName()));
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.load();
  }

  get type() { return 'excalidraw'; }

  get title() { return this.path ? displayName(this.path).replace(/\.excalidraw$/i, '') : 'Desenho'; }

  get iconName() { return 'pen-tool'; }

  async load() {
    try {
      const [text, lib] = await Promise.all([api.read(this.path), loadExcalidraw()]);
      if (this.destroyed) return;
      this.lastSaved = text;
      this.editor = lib.mount(this.host, {
        text,
        theme: themeName(),
        libraryItems: loadLibrary(),
        onLibraryChange: saveLibrary,
        onChange: (json) => {
          this.pending = json;
          this.scheduleSave();
        },
        onLinkOpen: (link) => this.openLink(link),
      });
    } catch (err) {
      this.host.replaceChildren(el('div', { class: 'excalidraw-error', text: `Não foi possível abrir o desenho: ${errorText(err)}` }));
    }
  }

  // [[Nota]] opens the note; web links open in the browser (the main process decides).
  openLink(link) {
    const wiki = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(link?.trim() ?? '');
    if (wiki) {
      const target = this.store.resolve(wiki[1].trim(), this.path);
      if (target) this.workspace.openFile(target, { newTab: true });
      else notice(`Nota não encontrada: ${wiki[1]}`);
      return;
    }
    if (/^https?:\/\//i.test(link ?? '')) window.open(link);
  }

  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  save() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || this.pending === null) return this.saving;
    const text = this.pending;
    const path = this.path;
    this.dirty = false;
    this.saving = this.saving.then(async () => {
      try {
        await api.write(path, text);
        this.lastSaved = text;
        return true;
      } catch (err) {
        this.dirty = true;
        notice(`Erro ao salvar o desenho: ${errorText(err)}`, { error: true });
        return false;
      }
    });
    return this.saving;
  }

  flushed() {
    clearTimeout(this.saveTimer);
    return this.saving;
  }

  // ---------- workspace contract ----------

  get isDirty() {
    return this.dirty;
  }

  async reloadIfClean() {
    if (this.dirty || !this.editor) return;
    const text = await api.read(this.path).catch(() => null);
    if (text === null || text === this.lastSaved) return;
    try {
      this.editor.load(text);
      this.lastSaved = text;
    } catch (err) {
      notice(`Desenho alterado fora do app, mas inválido: ${errorText(err)}`, { error: true });
    }
  }

  pathRenamed(from, to) {
    const next = this.path === from ? to : this.path.startsWith(`${from}/`) ? to + this.path.slice(from.length) : this.path;
    if (next === this.path) return;
    this.path = next;
    this.el.dataset.sourcePath = next;
    this.titleEl.textContent = this.title;
  }

  onShow() {
    renderDocStats(null);
  }

  onHide() {
    this.save();
  }

  destroy() {
    this.save();
    this.destroyed = true;
    this.themeObserver.disconnect();
    this.editor?.unmount();
  }

  serialize() {
    return { type: 'excalidraw', path: this.path };
  }
}
