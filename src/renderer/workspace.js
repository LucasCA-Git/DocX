import { el, icon, displayName, dirName, uniquePath, joinPath, errorText } from './dom';
import { NoteView } from './views/note-view';
import { GraphView } from './views/graph-view';
import { EmptyView } from './views/empty-view';
import { confirmDialog, notice } from './status';
import { newNotePath, linkTextFor } from '../shared/link-suggest';
import { prefs } from './prefs';
import { subpathLine } from '../shared/metadata';
import { linkUpdatesForRename } from '../shared/rename-links';
import { Pane, panesOf, parentOf, isSplit, renderLayout } from './workspace-layout';
import { showMenu } from './context-menu';

const api = window.docs;
const STORAGE_KEY = 'docs.workspace';
const RECENT_KEY = 'docs.recent';
const MAX_RECENT = 50;

// Tab groups (panes, splittable) with the view of each active tab; also the place every file
// operation goes through, so open tabs follow renames and deletions.
export class Workspace extends EventTarget {
  // extras(): buttons for the top-right tab bar (the right sidebar toggle).
  constructor({ store, rootEl, extras = () => [] }) {
    super();
    this.store = store;
    this.rootEl = rootEl;
    this.extras = extras;
    this.creating = new Map();
    this.draggedView = null;
    const pane = new Pane(this);
    this.layout = pane;
    this.activePane = pane;
    window.addEventListener('dragend', () => {
      this.draggedView = null;
    });
    try {
      this.recent = JSON.parse(localStorage.getItem(RECENT_KEY)) ?? [];
    } catch {
      this.recent = [];
    }
  }

  get panes() {
    return panesOf(this.layout);
  }

  // Every open view, in every pane.
  get views() {
    return this.panes.flatMap((p) => p.views);
  }

  get active() {
    return this.activePane?.active ?? null;
  }

  get activePath() {
    return this.active?.type === 'note' ? this.active.path : null;
  }

  paneOf(view) {
    return this.panes.find((p) => p.views.includes(view)) ?? null;
  }

  // ---------- views & tabs ----------

  add(view, { activate = true, pane = this.activePane } = {}) {
    const index = pane.active ? pane.views.indexOf(pane.active) + 1 : pane.views.length;
    pane.views.splice(index, 0, view);
    if (activate) this.activate(view);
    else this.renderTabs();
    return view;
  }

  activate(view) {
    const pane = this.paneOf(view);
    if (!pane) return;
    if (pane.active && pane.active !== view) pane.active.onHide();
    pane.active = view;
    pane.show(view);
    this.setActivePane(pane);
    view.onShow();
    this.renderTabs();
    this.changed();
  }

  focusPane(pane) {
    if (pane === this.activePane) return;
    this.setActivePane(pane);
    this.active?.onShow?.();
    this.changed();
  }

  setActivePane(pane) {
    this.activePane = pane;
    for (const p of this.panes) p.el.classList.toggle('is-active-pane', p === pane && this.panes.length > 1);
  }

  closeView(view) {
    const pane = this.paneOf(view);
    if (!pane) return;
    const index = pane.views.indexOf(view);
    view.destroy();
    pane.views.splice(index, 1);
    if (!pane.views.length && this.panes.length > 1) {
      this.removePane(pane);
      return;
    }
    if (pane.active === view) {
      pane.active = null;
      const next = pane.views[Math.min(index, pane.views.length - 1)];
      if (next) this.activate(next);
      else this.add(new EmptyView({ workspace: this }), { pane });
    } else {
      this.renderTabs();
      this.changed();
    }
  }

  cycle(delta) {
    const { views, active } = this.activePane;
    if (views.length < 2) return;
    const index = (views.indexOf(active) + delta + views.length) % views.length;
    this.activate(views[index]);
  }

  // A view loaded a new file or changed title.
  viewChanged(view) {
    this.renderTabs();
    if (view === this.active) this.changed();
  }

  // ---------- splits ----------

  // A new pane next to the active one (dir 'row' = to the right, 'column' = below) holding `view`
  // (an empty tab by default).
  split(dir = 'row', view = null) {
    const current = this.activePane;
    const pane = new Pane(this);
    const parent = parentOf(this.layout, current);
    if (parent && parent.dir === dir) {
      const i = parent.children.indexOf(current);
      parent.children.splice(i + 1, 0, pane);
      parent.sizes.splice(i + 1, 0, parent.sizes[i] / 2);
      parent.sizes[i] /= 2;
    } else {
      const node = { type: 'split', dir, children: [current, pane], sizes: [1, 1] };
      if (parent) parent.children[parent.children.indexOf(current)] = node;
      else this.layout = node;
    }
    this.renderLayout();
    this.add(view ?? new EmptyView({ workspace: this }), { pane });
    return pane;
  }

  // "Abrir à direita": the file in a new pane (or its existing tab).
  openSplit(path, dir = 'row') {
    const existing = this.views.find((v) => v.type === 'note' && v.path === path);
    if (existing) {
      this.activate(existing);
      return existing;
    }
    const view = new NoteView({ workspace: this, store: this.store, path });
    this.split(dir, view);
    return view;
  }

  removePane(pane) {
    const parent = parentOf(this.layout, pane);
    if (!parent) return;
    const i = parent.children.indexOf(pane);
    parent.children.splice(i, 1);
    parent.sizes.splice(i, 1);
    if (parent.children.length === 1) {
      const only = parent.children[0];
      const grand = parentOf(this.layout, parent);
      if (grand) grand.children[grand.children.indexOf(parent)] = only;
      else this.layout = only;
    }
    const next = this.panes[Math.min(i, this.panes.length - 1)];
    this.renderLayout();
    if (next.active) this.activate(next.active);
  }

  // Tab dragged to another position or pane.
  moveView(view, pane, index) {
    const from = this.paneOf(view);
    if (!view || !from) return;
    const old = from.views.indexOf(view);
    if (from === pane && (index === old || index === old + 1)) return;
    from.views.splice(old, 1);
    pane.views.splice(from === pane && index > old ? index - 1 : index, 0, view);
    if (from !== pane) {
      if (from.active === view) from.active = null;
      if (!from.views.length) {
        if (pane.active && pane.active !== view) pane.active.onHide();
        pane.active = view;
        pane.show(view);
        this.removePane(from);
        this.activate(view);
        return;
      }
      if (!from.active) {
        from.active = from.views[Math.min(old, from.views.length - 1)];
        from.show(from.active);
        from.active.onShow();
      }
    }
    this.activate(view);
  }

  renderLayout() {
    this.rootEl.replaceChildren(renderLayout(this.layout, { extras: this.extras, onResize: () => this.persist() }));
    this.setActivePane(this.panes.includes(this.activePane) ? this.activePane : this.panes[0]);
    this.renderTabs();
  }

  // ---------- pinned tabs ----------

  togglePin(view) {
    view.pinned = !view.pinned;
    this.renderTabs();
    this.persist();
  }

  tabMenu(view, x, y) {
    showMenu([
      { label: view.pinned ? 'Desafixar' : 'Fixar', icon: 'pin', action: () => this.togglePin(view) },
      { label: 'Dividir à direita', icon: 'columns', action: () => this.splitView(view, 'row') },
      { label: 'Dividir abaixo', icon: 'rows', action: () => this.splitView(view, 'column') },
      '-',
      { label: 'Fechar', icon: 'x', action: () => this.closeView(view) },
      { label: 'Fechar as outras abas', icon: 'x', action: () => this.closeOthers(view) },
    ], x, y);
  }

  // Moves a tab into a new pane beside its own.
  splitView(view, dir) {
    const pane = this.paneOf(view);
    if (!pane) return;
    if (pane.views.length === 1) {
      this.activePane = pane;
      this.split(dir);
      return;
    }
    this.setActivePane(pane);
    const index = pane.views.indexOf(view);
    pane.views.splice(index, 1);
    if (pane.active === view) {
      pane.active = pane.views[Math.min(index, pane.views.length - 1)];
      pane.show(pane.active);
    }
    this.split(dir, view);
  }

  closeOthers(view) {
    const pane = this.paneOf(view);
    for (const other of [...pane.views]) if (other !== view && !other.pinned) this.closeView(other);
  }

  // The note the side panels (backlinks, local graph) follow: the last active one, while a graph
  // or empty tab is in front too; null once that note was deleted.
  get followedNotePath() {
    return this.lastNotePath && this.store.has(this.lastNotePath) ? this.lastNotePath : null;
  }

  changed() {
    if (this.active?.type === 'note' && this.active.path) {
      this.lastNotePath = this.active.path;
      this.touchRecent(this.active.path);
    }
    this.persist();
    this.dispatchEvent(new Event('change'));
  }

  // Most recently opened files first (quick switcher with an empty query).
  touchRecent(path) {
    if (this.recent[0] === path) return;
    this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, MAX_RECENT);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      // storage unavailable
    }
  }

  renderTabs() {
    for (const pane of this.panes) pane.renderTabs();
  }

  // ---------- opening ----------

  newTab(pane = this.activePane) {
    return this.add(new EmptyView({ workspace: this }), { pane });
  }

  // A file already open switches to its tab, even when a new tab was asked for: two editors of one
  // file would overwrite each other's saves.
  openFile(path, { newTab = false, reveal = null } = {}) {
    const view = this.openFileView(path, { newTab });
    if (reveal !== null) view.revealWhenLoaded?.(path, reveal);
    return view;
  }

  openFileView(path, { newTab }) {
    const existing = this.views.find((v) => v.type === 'note' && v.path === path);
    if (existing) {
      this.activate(existing);
      return existing;
    }
    // A pinned tab keeps its note: links open in a new tab instead.
    if (!newTab && this.active?.type === 'note' && !this.active.pinned) {
      this.active.navigate(path);
      return this.active;
    }
    const view = new NoteView({ workspace: this, store: this.store, path });
    if (!newTab && this.active?.type === 'empty') {
      const empty = this.active;
      this.add(view);
      this.closeView(empty);
      return view;
    }
    return this.add(view);
  }

  openGraph() {
    const existing = this.views.find((v) => v.type === 'graph');
    if (existing) {
      this.activate(existing);
      return existing;
    }
    return this.add(new GraphView({ workspace: this, store: this.store }));
  }

  // [[target]] clicked: open it, or create the note when it does not exist yet.
  // "#Heading" / "#^block" after the name scroll to that place.
  async openLink(target, sourcePath, { newTab = false } = {}) {
    const hash = target.indexOf('#');
    const name = hash === -1 ? target : target.slice(0, hash);
    const subpath = hash === -1 ? null : target.slice(hash + 1);
    const resolved = this.store.resolve(name, sourcePath);
    if (resolved) {
      const line = subpathLine(this.store.index.metadata(resolved), subpath);
      this.openFile(resolved, { newTab, reveal: line === null ? null : { line } });
      return;
    }
    const rel = newNotePath(name);
    if (!rel) {
      notice(`"${name}" não existe no vault.`);
      return;
    }
    // A double click must not try to create the same note twice.
    if (!this.creating.has(rel)) {
      this.creating.set(rel, api.create(rel).then(() => this.store.refresh()).finally(() => this.creating.delete(rel)));
    }
    try {
      await this.creating.get(rel);
      this.openFile(rel, { newTab });
    } catch (err) {
      notice(err, { error: true });
    }
  }

  // Opens the search pane with this query (tag clicks, "search for selection"…).
  searchFor(query) {
    this.dispatchEvent(new CustomEvent('search', { detail: query }));
  }

  // ---------- editing notes from outside their editor ----------

  // Changes a note's text: through its editor when it is open (undoable, no clash with unsaved
  // typing), else on disk. transform(text) returns the new text (or the same text for no change).
  async editNoteText(rel, transform) {
    const view = this.views.find((v) => v.type === 'note' && v.path === rel);
    if (view?.isText) {
      const before = view.text();
      const after = transform(before);
      if (after !== before) {
        view.applyText(after);
        await view.save();
      }
      return after !== before;
    }
    const before = await api.read(rel);
    const after = transform(before);
    if (after === before) return false;
    await api.write(rel, after);
    this.store.updateNote(rel, after);
    return true;
  }

  // "Ligar" in unlinked mentions: the mention becomes [[target|mention]] (or [[mention]] when the
  // text already resolves to the target).
  // `expected` is the mention as listed; if the note changed since, nothing is touched.
  async linkMention(source, { line, from, to, text: expectedLine }, target) {
    let stale = false;
    try {
      await this.editNoteText(source, (text) => {
        const lines = text.split('\n');
        const current = lines[line]?.replace(/\r$/, '');
        if (current === undefined || current !== expectedLine) {
          stale = true;
          return text;
        }
        const mention = current.slice(from, to);
        const name = linkTextFor(target, this.store.index.lookup, source);
        const linkText = this.store.index.resolve(mention, source) === target ? mention : `${name}|${mention}`;
        lines[line] = `${lines[line].slice(0, from)}[[${linkText}]]${lines[line].slice(to)}`;
        return lines.join('\n');
      });
    } catch (err) {
      notice(err, { error: true });
    }
    if (stale) notice('A nota mudou desde a busca de menções; confira a lista atualizada.');
  }

  // ---------- file operations ----------

  async createNote(folder = prefs.get('newNoteFolder')) {
    const rel = uniquePath(folder, 'Sem título', '.md', this.store.files);
    try {
      await api.create(rel);
      await this.store.refresh();
      const view = this.openFile(rel);
      setTimeout(() => view.focusTitle?.(), 50);
    } catch (err) {
      notice(err, { error: true });
    }
  }

  // A note with this name ("pasta/Nome" keeps the folder) — opened if it exists, created otherwise.
  async createNoteNamed(name, { newTab = false, content = '' } = {}) {
    const clean = name.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!clean) return null;
    const rel = newNotePath(clean.includes('/') || !prefs.get('newNoteFolder') ? clean : `${prefs.get('newNoteFolder')}/${clean}`);
    if (!rel) {
      notice(`"${clean}" não é um nome de nota válido.`, { error: true });
      return null;
    }
    const existing = this.store.files.find((f) => f.toLowerCase() === rel.toLowerCase());
    if (existing) return this.openFile(existing, { newTab });
    try {
      await api.create(rel);
      if (content) await api.write(rel, content);
      await this.store.refresh();
      return this.openFile(rel, { newTab });
    } catch (err) {
      notice(err, { error: true });
      return null;
    }
  }

  async createFolder(parent = '') {
    const rel = uniquePath(parent, 'Sem título', '', [...this.store.folders, ...this.store.files]);
    await api.mkdir(rel);
    await this.store.refresh();
    return rel;
  }

  // Text of a note as the user sees it: the open editor's, else the last one read from disk.
  currentText(rel) {
    const view = this.views.find((v) => v.type === 'note' && v.path === rel && v.isText);
    return view ? view.text() : this.store.texts.get(rel);
  }

  // Renames/moves a file or folder; with "atualizar links" on, [[links]] pointing into it are
  // rewritten in every note (through the editor when the note is open).
  async renamePath(from, to) {
    if (from === to) return;
    if (!(await this.saveAll())) throw new Error('Há alterações não salvas; renomeação cancelada');
    const updates = prefs.get('autoUpdateLinks')
      ? linkUpdatesForRename(this.store.index, (p) => this.currentText(p), from, to)
      : new Map();
    const before = new Map([...updates.keys()].map((p) => [p, this.currentText(p)]));
    await api.rename(from, to);
    for (const view of this.views) view.pathRenamed?.(from, to);
    if (this.lastNotePath === from) this.lastNotePath = to;
    this.dispatchEvent(new CustomEvent('renamed', { detail: { from, to } }));
    await this.store.refresh();
    this.renderTabs();
    this.changed();
    if (!updates.size) return;
    const map = (p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    let count = 0;
    for (const [source, text] of updates) {
      try {
        // Edited in between: that note is left alone rather than overwritten.
        if (await this.editNoteText(map(source), (current) => (current === before.get(source) ? text : current))) count++;
      } catch (err) {
        notice(`Não foi possível atualizar os links em "${displayName(source)}": ${errorText(err)}`, { error: true });
      }
    }
    if (count) notice(`Links atualizados em ${count} ${count === 1 ? 'nota' : 'notas'}.`);
  }

  async movePath(from, folder) {
    const to = joinPath(folder, from.split('/').pop());
    if (to === from || dirName(from) === folder || folder === from || folder.startsWith(`${from}/`)) return;
    try {
      await this.renamePath(from, to);
    } catch (err) {
      notice(err, { error: true });
    }
  }

  async deletePath(rel) {
    const isFolder = this.store.folders.includes(rel);
    const label = isFolder ? `a pasta "${rel}" e tudo dentro dela` : `"${displayName(rel)}"`;
    if (!(await confirmDialog(`Mover ${label} para a lixeira?`, { confirmLabel: 'Excluir', danger: true }))) return;
    const affected = this.views.filter((v) => v.path === rel || v.path?.startsWith(`${rel}/`));
    try {
      // A write still in flight would recreate the file after the delete.
      await Promise.all(affected.map((v) => v.flushed()));
      await api.remove(rel);
    } catch (err) {
      notice(err, { error: true });
      return;
    }
    for (const view of affected) {
      view.dirty = false;
      this.closeView(view);
    }
    await this.store.refresh();
  }

  // Files changed on disk (sync, other editor): reload clean views, close views of deleted files.
  async vaultChanged() {
    for (const view of [...this.views]) {
      if (view.type !== 'note' || !view.path) continue;
      if (!this.store.has(view.path) && !view.dirty) this.closeView(view);
      else view.reloadIfClean().catch(() => {});
    }
  }

  async saveAll() {
    const results = await Promise.all(this.views.map((view) => view.save?.() ?? true));
    return results.every(Boolean);
  }

  // ---------- persistence ----------

  serializeNode(node) {
    if (isSplit(node)) return { type: 'split', dir: node.dir, sizes: node.sizes, children: node.children.map((c) => this.serializeNode(c)) };
    return {
      type: 'pane',
      views: node.views.map((v) => ({ ...v.serialize(), pinned: Boolean(v.pinned) })),
      active: node.views.indexOf(node.active),
      focused: node === this.activePane,
    };
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, layout: this.serializeNode(this.layout) }));
    } catch {
      // storage unavailable: tabs simply start fresh next time
    }
  }

  makeView(saved) {
    let view = null;
    if (saved?.type === 'graph') view = new GraphView({ workspace: this, store: this.store });
    else if (saved?.type === 'note' && saved.path && this.store.has(saved.path)) view = new NoteView({ workspace: this, store: this.store, path: saved.path });
    if (view) view.pinned = Boolean(saved.pinned);
    return view;
  }

  restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      saved = null;
    }
    // Version 1: one tab list.
    if (saved && !saved.layout) saved = { layout: { type: 'pane', views: saved.views ?? [], active: saved.active, focused: true } };
    const toShow = [];
    let focused = null;
    const build = (node) => {
      if (node?.type === 'split' && Array.isArray(node.children)) {
        const children = node.children.map(build).filter(Boolean);
        if (!children.length) return null;
        if (children.length === 1) return children[0];
        const sizes = Array.isArray(node.sizes) && node.sizes.length === node.children.length ? node.sizes : null;
        return { type: 'split', dir: node.dir === 'column' ? 'column' : 'row', children, sizes: sizes && children.length === node.children.length ? sizes : children.map(() => 1) };
      }
      const pane = new Pane(this);
      const made = (node?.views ?? []).map((v) => this.makeView(v));
      pane.views = made.filter(Boolean);
      if (!pane.views.length) return null;
      pane.active = made[node.active] ?? pane.views[0];
      toShow.push(pane);
      if (node.focused) focused = pane;
      return pane;
    };
    this.layout = build(saved?.layout) ?? new Pane(this);
    if (!this.panes[0].views.length) this.panes[0].views.push(new EmptyView({ workspace: this }));
    this.activePane = focused ?? this.panes[0];
    this.renderLayout();
    for (const pane of this.panes) {
      pane.active ??= pane.views[0];
      pane.show(pane.active);
      if (pane !== this.activePane) pane.active.onShow();
    }
    this.activate(this.activePane.active);
  }

  reset() {
    for (const view of this.views) view.destroy();
    this.layout = new Pane(this);
    this.activePane = this.layout;
    this.renderLayout();
    this.add(new EmptyView({ workspace: this }));
  }
}
