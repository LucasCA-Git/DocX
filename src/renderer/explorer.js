import {
  el, icon, TEXT_FILE, baseName, dirName, displayName, extension, joinPath, uniquePath,
} from './dom';
import { linkTextFor } from '../shared/link-suggest';
import { showMenu } from './context-menu';
import { notice } from './status';
import { openSuggest, highlighted } from './suggest-modal';
import { fuzzySort } from '../shared/fuzzy';

const api = window.docs;
const EXPANDED_KEY = 'docs.explorer.expanded';
const SORT_KEY = 'docs.explorer.sort';
const byName = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });

export const SORTS = [
  ['name-asc', 'Nome (A a Z)'],
  ['name-desc', 'Nome (Z a A)'],
  ['mtime-desc', 'Modificado (mais novo primeiro)'],
  ['mtime-asc', 'Modificado (mais antigo primeiro)'],
  ['ctime-desc', 'Criado (mais novo primeiro)'],
  ['ctime-asc', 'Criado (mais antigo primeiro)'],
];

function loadExpanded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

// File explorer: folders first, collapsible, inline rename, context menu, drag & drop to move.
export class Explorer {
  constructor({ store, workspace, rootEl }) {
    this.store = store;
    this.workspace = workspace;
    this.rootEl = rootEl;
    this.expanded = loadExpanded();
    this.renaming = null;
    this.pendingRender = false;
    this.lastActive = null;
    this.sort = localStorage.getItem(SORT_KEY) ?? 'name-asc';

    workspace.addEventListener('renamed', ({ detail: { from, to } }) => this.remapExpanded(from, to));

    rootEl.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.tree-item-self')) return;
      event.preventDefault();
      this.folderMenu('', event.clientX, event.clientY);
    });
    this.makeDropTarget(rootEl, '');
  }

  saveExpanded() {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded]));
    } catch {
      // not persisted; harmless
    }
  }

  toggle(folder, open = !this.expanded.has(folder)) {
    if (open) this.expanded.add(folder);
    else this.expanded.delete(folder);
    this.saveExpanded();
    this.render();
  }

  setSort(sort) {
    this.sort = sort;
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      // not persisted
    }
    this.render();
  }

  sortMenu(x, y) {
    showMenu(SORTS.map(([id, label]) => ({ label, icon: id === this.sort ? 'check' : null, action: () => this.setSort(id) })), x, y);
  }

  compareFiles(a, b) {
    const [key, dir] = this.sort.split('-');
    const sign = dir === 'desc' ? -1 : 1;
    if (key === 'name') return sign * byName(displayName(a), displayName(b));
    const i = key === 'mtime' ? 0 : 1;
    const ta = this.store.times?.[a]?.[i] ?? 0;
    const tb = this.store.times?.[b]?.[i] ?? 0;
    return sign * (ta - tb) || byName(displayName(a), displayName(b));
  }

  collapseAll() {
    this.expanded.clear();
    this.saveExpanded();
    this.render();
  }

  // Opening a file expands its folders ("reveal active file").
  reveal(rel) {
    const parts = dirName(rel).split('/').filter(Boolean);
    let changed = false;
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!this.expanded.has(folder)) {
        this.expanded.add(folder);
        changed = true;
      }
    }
    if (changed) this.saveExpanded();
  }

  buildTree() {
    const root = { folders: new Map(), files: [] };
    const folderNode = (rel) => {
      let node = root;
      for (const part of rel.split('/').filter(Boolean)) {
        if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
        node = node.folders.get(part);
      }
      return node;
    };
    for (const folder of this.store.folders) folderNode(folder);
    for (const file of this.store.files) folderNode(dirName(file)).files.push(file);
    return root;
  }

  // A renamed folder keeps its open subfolders open.
  remapExpanded(from, to) {
    const next = new Set();
    for (const folder of this.expanded) {
      next.add(folder === from || folder.startsWith(`${from}/`) ? to + folder.slice(from.length) : folder);
    }
    this.expanded = next;
    this.saveExpanded();
  }

  // Store/workspace changes re-render the tree, except while an inline rename is being typed.
  render() {
    if (this.renaming) {
      this.pendingRender = true;
      return;
    }
    this.draw();
  }

  draw() {
    this.pendingRender = false;
    const active = this.workspace.activePath;
    const activeChanged = active !== this.lastActive;
    this.lastActive = active;
    if (active && activeChanged) this.reveal(active);
    this.rootEl.replaceChildren(this.renderChildren(this.buildTree(), '', active, 0));
    if (activeChanged) this.rootEl.querySelector('.tree-item-self.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  renderChildren(node, prefix, active, depth) {
    const children = el('div', { class: 'tree-item-children' });
    const folderSign = this.sort === 'name-desc' ? -1 : 1;
    for (const [name, child] of [...node.folders].sort(([a], [b]) => folderSign * byName(a, b))) {
      const rel = joinPath(prefix, name);
      const open = this.expanded.has(rel);
      const self = this.itemSelf(rel, 'folder', depth, [
        el('span', { class: `tree-item-icon collapse-icon${open ? '' : ' is-collapsed'}` }, icon('chevron-right', 14)),
        this.label(rel, name),
      ]);
      self.addEventListener('click', () => this.toggle(rel));
      this.makeDropTarget(self, rel);
      children.append(el('div', { class: 'tree-item nav-folder' }, self, open ? this.renderChildren(child, rel, active, depth + 1) : null));
    }
    for (const rel of node.files.sort((a, b) => this.compareFiles(a, b))) {
      const ext = extension(rel);
      const self = this.itemSelf(rel, 'file', depth, [
        this.label(rel, TEXT_FILE.test(rel) && ext === 'md' ? displayName(rel) : baseName(rel).replace(/\.[^.]+$/, '')),
        ext !== 'md' ? el('span', { class: 'nav-file-tag', text: ext.toUpperCase() }) : null,
      ]);
      if (rel === active) self.classList.add('is-active');
      self.addEventListener('click', (event) => this.workspace.openFile(rel, { newTab: event.ctrlKey || event.metaKey }));
      self.addEventListener('auxclick', (event) => {
        if (event.button === 1) this.workspace.openFile(rel, { newTab: true });
      });
      children.append(el('div', { class: 'tree-item nav-file' }, self));
    }
    return children;
  }

  itemSelf(rel, kind, depth, content) {
    const self = el('div', {
      class: `tree-item-self is-${kind}`,
      draggable: 'true',
      title: rel,
      dataset: { path: rel },
      style: `padding-left: ${8 + depth * 16}px`,
    }, content);
    self.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (kind === 'folder') this.folderMenu(rel, event.clientX, event.clientY);
      else this.fileMenu(rel, event.clientX, event.clientY);
    });
    self.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-docs-path', rel);
      event.dataTransfer.effectAllowed = 'move';
    });
    return self;
  }

  label(rel, text) {
    if (this.renaming !== rel) return el('span', { class: 'tree-item-inner', text });
    const input = el('input', { class: 'tree-rename', value: text, spellcheck: 'false' });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit) this.commitRename(rel, input.value);
      else this.draw();
    };
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  startRename(rel) {
    this.renaming = rel;
    this.reveal(rel);
    this.draw();
  }

  async commitRename(rel, value) {
    const name = value.trim().replace(/[\\/]/g, '-');
    const isFolder = this.store.folders.includes(rel);
    const ext = isFolder ? '' : (baseName(rel).match(/\.[^.]+$/)?.[0] ?? '');
    const current = isFolder ? baseName(rel) : baseName(rel).slice(0, baseName(rel).length - ext.length);
    if (!name || name === current) {
      this.draw();
      return;
    }
    try {
      await this.workspace.renamePath(rel, joinPath(dirName(rel), `${name}${ext}`));
    } catch (err) {
      notice(err, { error: true });
      this.draw();
    }
  }

  makeDropTarget(node, folder) {
    node.addEventListener('dragover', (event) => {
      if (!event.dataTransfer.types.includes('application/x-docs-path')) return;
      event.preventDefault();
      event.stopPropagation();
      node.classList.add('is-drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-drop-target'));
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      node.classList.remove('is-drop-target');
      const rel = event.dataTransfer.getData('application/x-docs-path');
      if (rel) this.workspace.movePath(rel, folder);
    });
  }

  async newFolder(parent = '') {
    try {
      if (parent) this.expanded.add(parent);
      const rel = await this.workspace.createFolder(parent);
      this.startRename(rel);
    } catch (err) {
      notice(err, { error: true });
    }
  }

  folderMenu(rel, x, y) {
    showMenu([
      { label: 'Nova nota', icon: 'file-plus', action: () => this.workspace.createNote(rel) },
      { label: 'Nova pasta', icon: 'folder-plus', action: () => this.newFolder(rel) },
      { label: 'Novo canvas', icon: 'canvas', action: () => this.workspace.createCanvas(rel) },
      { label: 'Novo desenho', icon: 'pen-tool', action: () => this.workspace.createDrawing(rel) },
      { label: 'Novo diagrama', icon: 'workflow', action: () => this.workspace.createDiagram(rel) },
      ...(rel ? ['-',
        { label: 'Renomear', icon: 'pencil', action: () => this.startRename(rel) },
        { label: 'Mover para…', icon: 'folder-input', action: () => this.moveTo(rel) },
        { label: 'Copiar caminho', icon: 'copy', action: () => copyText(rel) },
        { label: 'Mostrar na pasta do sistema', icon: 'folder-open', action: () => api.revealInFolder(rel) },
        '-',
        { label: 'Excluir', icon: 'trash', danger: true, action: () => this.workspace.deletePath(rel) }]
        : [{ label: 'Mostrar na pasta do sistema', icon: 'folder-open', action: () => api.revealInFolder('') }]),
    ], x, y);
  }

  fileMenu(rel, x, y) {
    const lookup = this.store.index.lookup;
    showMenu([
      { label: 'Abrir em nova aba', icon: 'file-text', action: () => this.workspace.openFile(rel, { newTab: true }) },
      ...(this.workspace.openSplit ? [{ label: 'Abrir à direita', icon: 'columns', action: () => this.workspace.openSplit(rel, 'row') }] : []),
      '-',
      { label: 'Renomear', icon: 'pencil', action: () => this.startRename(rel) },
      { label: 'Mover para…', icon: 'folder-input', action: () => this.moveTo(rel) },
      { label: 'Duplicar', icon: 'copy', action: () => this.duplicate(rel) },
      { label: this.workspace.bookmarks?.has(rel) ? 'Remover dos favoritos' : 'Favoritar', icon: 'bookmark', action: () => this.workspace.bookmarks?.toggleFile(rel) },
      '-',
      { label: 'Copiar link', icon: 'link', action: () => copyText(`[[${linkTextFor(rel, lookup, null)}]]`) },
      { label: 'Copiar caminho', icon: 'copy', action: () => copyText(rel) },
      { label: 'Mostrar na pasta do sistema', icon: 'folder-open', action: () => api.revealInFolder(rel) },
      '-',
      { label: 'Excluir', icon: 'trash', danger: true, action: () => this.workspace.deletePath(rel) },
    ], x, y);
  }

  // Folder picker (fuzzy) for "Mover para…".
  moveTo(rel) {
    const folders = ['', ...this.store.folders].filter((f) => f !== rel && !f.startsWith(`${rel}/`) && f !== dirName(rel));
    openSuggest({
      placeholder: `Mover "${baseName(rel)}" para…`,
      instructions: [['↑↓', 'navegar'], ['Enter', 'mover'], ['Esc', 'cancelar']],
      getItems: (query) => (query.trim()
        ? fuzzySort(query, folders, (f) => f || '/').map((r) => ({ folder: r.item, ranges: r.ranges }))
        : folders.map((folder) => ({ folder, ranges: [] }))),
      render: ({ folder, ranges }) => [icon('folder', 16), el('span', { class: 'suggestion-main' }, ...highlighted(folder || '/', ranges))],
      choose: (item) => item && this.workspace.movePath(rel, item.folder),
    });
  }

  async duplicate(rel) {
    const ext = baseName(rel).match(/\.[^.]+$/)?.[0] ?? '';
    const stem = baseName(rel).slice(0, baseName(rel).length - ext.length);
    const to = uniquePath(dirName(rel), stem, ext, this.store.files);
    try {
      await api.copy(rel, to);
      await this.store.refresh();
      if (TEXT_FILE.test(to)) this.workspace.openFile(to);
    } catch (err) {
      notice(err, { error: true });
    }
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => notice('Copiado.', { timeout: 1500 }), (err) => notice(err, { error: true }));
}
