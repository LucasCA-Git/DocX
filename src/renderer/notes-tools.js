import { el, icon, iconButton, displayName, dirName, joinPath, uniquePath } from './dom';
import { prefs } from './prefs';
import { formatDate, applyTemplate } from '../shared/templates';
import { fuzzySort } from '../shared/fuzzy';
import { openSuggest, highlighted } from './suggest-modal';
import { insertText } from './editor-setup';
import { notice } from './status';

const api = window.docs;
const BOOKMARKS_KEY = 'docs.bookmarks';
const clean = (folder) => folder.trim().replace(/^\/+|\/+$/g, '');
const withMd = (rel) => (/\.(md|markdown|txt)$/i.test(rel) ? rel : `${rel}.md`);

async function templateText(store, rel, title) {
  const path = store.resolve(rel.replace(/\.md$/i, ''), null) ?? withMd(clean(rel));
  if (!store.has(path)) {
    notice(`O modelo "${rel}" não existe.`, { error: true });
    return '';
  }
  const text = await api.read(path);
  return applyTemplate(text, { title, dateFormat: prefs.get('templateDateFormat'), timeFormat: prefs.get('templateTimeFormat') });
}

// ---------- daily notes ----------

const dailyPath = (date) => withMd(joinPath(clean(prefs.get('dailyFolder')), formatDate(date, prefs.get('dailyFormat') || 'YYYY-MM-DD')));

// Opens (creating from the template when needed) the daily note `offsetDays` from today.
export async function openDailyNote({ workspace, store }, offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const rel = dailyPath(date);
  if (!store.has(rel)) {
    const template = prefs.get('dailyTemplate').trim();
    const content = template ? await templateText(store, template, displayName(rel)) : '';
    try {
      await api.create(rel);
      if (content) await api.write(rel, content);
      await store.refresh();
    } catch (err) {
      notice(err, { error: true });
      return;
    }
  }
  workspace.openFile(rel);
}

// The previous/next existing daily note relative to the open one (names sort by date).
export function openAdjacentDaily({ workspace, store }, step) {
  const folder = clean(prefs.get('dailyFolder'));
  const notes = store.files.filter((f) => dirName(f) === folder && /\.md$/i.test(f)).sort();
  const current = workspace.activePath;
  const index = notes.indexOf(current);
  if (index === -1) {
    notice('Abra uma nota diária primeiro.');
    return;
  }
  const next = notes[index + step];
  if (next) workspace.openFile(next);
  else notice(step < 0 ? 'Não há nota diária anterior.' : 'Não há nota diária seguinte.');
}

// ---------- templates ----------

export function insertTemplate({ store, view }) {
  const folder = clean(prefs.get('templatesFolder'));
  const templates = store.files.filter((f) => /\.md$/i.test(f) && (!folder || f.startsWith(`${folder}/`)));
  if (!templates.length) {
    notice(`Nenhum modelo em "${folder || '/'}". Crie notas nessa pasta (Configurações › Modelos).`);
    return;
  }
  openSuggest({
    placeholder: 'Escolha um modelo…',
    instructions: [['↑↓', 'navegar'], ['Enter', 'inserir'], ['Esc', 'cancelar']],
    getItems: (q) => (q.trim() ? fuzzySort(q, templates, displayName).map((r) => ({ path: r.item, ranges: r.ranges }))
      : templates.map((path) => ({ path, ranges: [] }))),
    render: ({ path, ranges }) => [icon('file-text', 16), el('span', { class: 'suggestion-main' }, ...highlighted(displayName(path), ranges))],
    choose: async (item) => {
      if (!item) return;
      const text = await templateText(store, item.path, displayName(view.path));
      insertText(view.editor, text);
    },
  });
}

// ---------- random and unique notes ----------

export function openRandomNote({ workspace, store }) {
  const notes = store.files.filter((f) => /\.md$/i.test(f) && f !== workspace.activePath);
  if (!notes.length) return;
  workspace.openFile(notes[Math.floor(Math.random() * notes.length)]);
}

export async function createUniqueNote({ workspace, store }) {
  const stem = formatDate(new Date(), 'YYYYMMDDHHmm');
  const rel = uniquePath(clean(prefs.get('newNoteFolder')), stem, '.md', store.files);
  try {
    await api.create(rel);
    await store.refresh();
    workspace.openFile(rel);
  } catch (err) {
    notice(err, { error: true });
  }
}

// ---------- bookmarks ----------

// Bookmarked notes and searches, per device: [{ type: 'file', path } | { type: 'search', query }].
export class Bookmarks extends EventTarget {
  constructor(workspace) {
    super();
    try {
      this.items = JSON.parse(localStorage.getItem(BOOKMARKS_KEY)) ?? [];
    } catch {
      this.items = [];
    }
    workspace.addEventListener('renamed', ({ detail: { from, to } }) => {
      let changed = false;
      for (const item of this.items) {
        if (item.type === 'file' && (item.path === from || item.path.startsWith(`${from}/`))) {
          item.path = to + item.path.slice(from.length);
          changed = true;
        }
      }
      if (changed) this.save();
    });
  }

  save() {
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(this.items));
    } catch {
      // not persisted
    }
    this.dispatchEvent(new Event('change'));
  }

  has(path) {
    return this.items.some((i) => i.type === 'file' && i.path === path);
  }

  toggleFile(path) {
    if (this.has(path)) this.items = this.items.filter((i) => !(i.type === 'file' && i.path === path));
    else this.items.push({ type: 'file', path });
    this.save();
  }

  addSearch(query) {
    if (!query.trim() || this.items.some((i) => i.type === 'search' && i.query === query)) return;
    this.items.push({ type: 'search', query });
    this.save();
  }

  remove(item) {
    this.items = this.items.filter((i) => i !== item);
    this.save();
  }

  move(item, delta) {
    const i = this.items.indexOf(item);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= this.items.length) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    this.save();
  }
}

export function renderBookmarks(host, { bookmarks, workspace, store }) {
  const draw = () => {
    if (!bookmarks.items.length) {
      host.replaceChildren(el('p', { class: 'pane-empty', text: 'Nenhum favorito. Use "Favoritar" no menu da nota ou a paleta (Ctrl+P).' }));
      return;
    }
    host.replaceChildren(...bookmarks.items.map((item) => {
      const missing = item.type === 'file' && !store.has(item.path);
      const row = el('div', {
        class: `bookmark-item${missing ? ' is-missing' : ''}`,
        title: item.type === 'file' ? item.path : item.query,
        onclick: (event) => (item.type === 'file' ? workspace.openFile(item.path, { newTab: event.ctrlKey || event.metaKey }) : workspace.searchFor(item.query)),
      },
      icon(item.type === 'file' ? 'file-text' : 'search', 14),
      el('span', { class: 'bookmark-title', text: item.type === 'file' ? displayName(item.path) : item.query }),
      el('span', { class: 'bookmark-actions' },
        iconButton('arrow-up-down', 'Mover para cima', (e) => { e.stopPropagation(); bookmarks.move(item, -1); }),
        iconButton('x', 'Remover dos favoritos', (e) => { e.stopPropagation(); bookmarks.remove(item); })));
      return row;
    }));
  };
  bookmarks.addEventListener('change', draw);
  store.addEventListener('change', draw);
  draw();
}
