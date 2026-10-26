import { el, icon, displayName, baseName, dirName, IMAGE_FILE } from './dom';
import { fuzzySort } from '../shared/fuzzy';
import { formatHotkey } from '../shared/hotkeys';
import { openSuggest, highlighted } from './suggest-modal';
import { commands } from './commands';

const RECENT_COMMANDS_KEY = 'docs.recentCommands';
const fileLabel = (rel) => (/\.md$/i.test(rel) ? displayName(rel) : baseName(rel));

// Ctrl+O: open a file by name (aliases count too); Enter with no match creates the note.
export function openQuickSwitcher({ store, workspace }) {
  const entries = () => {
    const out = store.files.map((path) => ({ path, label: fileLabel(path) }));
    for (const [path, aliases] of store.index.aliases ?? []) {
      for (const alias of aliases) out.push({ path, label: alias, alias: true });
    }
    return out;
  };
  openSuggest({
    placeholder: 'Digite o nome de uma nota…',
    instructions: [['↑↓', 'navegar'], ['Enter', 'abrir'], ['Ctrl+Enter', 'nova aba'], ['Shift+Enter', 'criar'], ['Esc', 'fechar']],
    getItems: (query) => {
      const q = query.trim();
      if (!q) {
        const recent = workspace.recent.filter((p) => store.has(p));
        const rest = store.files.filter((p) => !recent.includes(p)).sort((a, b) => fileLabel(a).localeCompare(fileLabel(b)));
        return [...recent, ...rest].map((path) => ({ path, label: fileLabel(path), ranges: [] }));
      }
      const results = fuzzySort(q, entries(), (e) => e.label).map((r) => ({ ...r.item, ranges: r.ranges }));
      const exact = results.some((r) => r.label.toLowerCase() === q.toLowerCase());
      if (!exact) results.push({ create: q });
      return results;
    },
    render: (item) => {
      if (item.create) {
        return [icon('file-plus', 16), el('span', { class: 'suggestion-main', text: `Criar "${item.create}"` }), el('span', { class: 'suggestion-aux' }, el('kbd', { text: 'Enter' }))];
      }
      return [
        icon(item.alias ? 'link' : IMAGE_FILE.test(item.path) ? 'image' : 'file-text', 16),
        el('div', { class: 'suggestion-main' },
          el('div', {}, ...highlighted(item.label, item.ranges)),
          item.alias ? el('div', { class: 'suggestion-note', text: `↳ ${fileLabel(item.path)}` })
            : dirName(item.path) ? el('div', { class: 'suggestion-note', text: dirName(item.path) }) : null),
      ];
    },
    choose: (item, { ctrlKey, shiftKey, query }) => {
      if (item?.create || (shiftKey && query.trim())) {
        workspace.createNoteNamed(item?.create ?? query.trim(), { newTab: ctrlKey });
      } else if (item) {
        workspace.openFile(item.path, { newTab: ctrlKey });
      }
    },
  });
}

function recentCommands() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_COMMANDS_KEY)) ?? [];
  } catch {
    return [];
  }
}

// Ctrl+P: every available command, fuzzy-filtered, last used first.
export function openCommandPalette() {
  openSuggest({
    placeholder: 'Digite um comando…',
    instructions: [['↑↓', 'navegar'], ['Enter', 'executar'], ['Esc', 'fechar']],
    getItems: (query) => {
      const available = commands.available();
      if (!query.trim()) {
        const recent = recentCommands();
        const rank = (c) => {
          const i = recent.indexOf(c.id);
          return i === -1 ? Infinity : i;
        };
        return [...available].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((c) => ({ command: c, ranges: [] }));
      }
      return fuzzySort(query, available, (c) => c.name).map((r) => ({ command: r.item, ranges: r.ranges }));
    },
    render: ({ command, ranges }) => [
      el('span', { class: 'suggestion-main' }, ...highlighted(command.name, ranges)),
      el('span', { class: 'suggestion-aux' }, commands.hotkeysOf(command.id).map((hk) => el('kbd', { text: formatHotkey(hk) }))),
    ],
    choose: (item) => {
      if (!item) return;
      const recent = [item.command.id, ...recentCommands().filter((id) => id !== item.command.id)].slice(0, 20);
      try {
        localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(recent));
      } catch {
        // storage unavailable
      }
      commands.run(item.command.id);
    },
    empty: 'Nenhum comando encontrado.',
  });
}
