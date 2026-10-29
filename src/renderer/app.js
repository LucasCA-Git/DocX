import { $, iconButton } from './dom';
import { VaultStore } from './vault-store';
import { Workspace } from './workspace';
import { Explorer } from './explorer';
import { RightSidebar } from './right-sidebar';
import { SearchPane } from './search-pane';
import { setupSettings } from './settings';
import { notice, renderSyncStatus } from './status';
import { commands } from './commands';
import { openCommandPalette, openQuickSwitcher } from './switcher';
import { hotkeysSection } from './hotkeys-settings';
import { ClaudePane, claudeSection } from './claude-pane';
import { setupHoverPreview } from './hover-preview';
import { EDITOR_COMMANDS } from './editor-setup';
import { setupAppearance } from './appearance';
import { prefs } from './prefs';
import {
  openDailyNote, openAdjacentDaily, insertTemplate, createUniqueNote, Bookmarks, renderBookmarks,
} from './notes-tools';

const api = window.docs;

const store = new VaultStore();
const workspace = new Workspace({
  store,
  rootEl: $('#workspace-root'),
  extras: () => [iconButton('panel-right', 'Barra lateral direita (Ctrl+Shift+B)', () => rightSidebar.toggle(), 'clickable-icon right-sidebar-toggle')],
});
const explorer = new Explorer({ store, workspace, rootEl: $('#tree') });

const bookmarks = new Bookmarks(workspace);
workspace.bookmarks = bookmarks;
const rightSidebar = new RightSidebar({ store, workspace, rootEl: $('#right-sidebar') });
const search = new SearchPane({ store, workspace, rootEl: $('#search-pane') });

store.addEventListener('change', () => explorer.render());
setupHoverPreview({ store, workspace });
setupAppearance();
workspace.addEventListener('change', () => explorer.render());

const vaultName = (cfg) => cfg.vaultPath.split(/[\\/]/).filter(Boolean).pop() || 'DocX';

const openSettings = setupSettings({
  extraSections: [hotkeysSection, claudeSection],
  beforeSave: () => workspace.saveAll(),
  onSaved: async (cfg) => {
    $('#vault-name').textContent = vaultName(cfg);
    claude.setVault(cfg.vaultPath);
    await store.refresh();
    workspace.reset();
  },
});

const claude = new ClaudePane({ store, workspace, openSettings: () => openSettings('claude') });
rightSidebar.addPane({ id: 'claude', icon: 'sparkles', title: 'Claude (Ctrl+Shift+L)', render: null, el: claude.el, wide: true, onShow: () => claude.onShow() });

// ---------- commands ----------

const view = () => workspace.active;
const noteView = () => (workspace.active?.type === 'note' && workspace.active.path ? workspace.active : null);
const textView = () => (noteView()?.isText ? noteView() : null);

function toggleSidebar() {
  document.body.classList.toggle('is-left-sidebar-collapsed');
}

const syncNow = () => api.syncNow().catch((err) => notice(err, { error: true }));

[
  { id: 'app:command-palette', name: 'Abrir paleta de comandos', hotkeys: ['Mod+P'], run: openCommandPalette },
  { id: 'switcher:open', name: 'Troca rápida: abrir nota', hotkeys: ['Mod+O'], run: () => openQuickSwitcher({ store, workspace }) },
  { id: 'search:open', name: 'Buscar no vault', hotkeys: ['Mod+Shift+F'], run: () => showLeftPane('search') },
  { id: 'explorer:open', name: 'Mostrar explorador de arquivos', run: () => showLeftPane('files') },
  { id: 'explorer:reveal-active', name: 'Revelar nota ativa no explorador', check: noteView, run: () => { showLeftPane('files'); explorer.reveal(noteView().path); } },
  { id: 'explorer:collapse-all', name: 'Recolher todas as pastas', run: () => explorer.collapseAll() },
  { id: 'app:toggle-left-sidebar', name: 'Recolher/expandir barra lateral esquerda', hotkeys: ['Mod+\\'], run: toggleSidebar },
  { id: 'outline:open', name: 'Mostrar estrutura (títulos) da nota', run: () => rightSidebar.showTab('outline') },
  { id: 'backlinks:open', name: 'Mostrar backlinks', run: () => rightSidebar.showTab('backlinks') },
  { id: 'outgoing:open', name: 'Mostrar links de saída', run: () => rightSidebar.showTab('outgoing') },
  { id: 'tags:open', name: 'Mostrar tags', run: () => rightSidebar.showTab('tags') },
  { id: 'localgraph:open', name: 'Mostrar grafo local', run: () => rightSidebar.showTab('graph') },
  { id: 'claude:open', name: 'Conversar com o Claude', hotkeys: ['Mod+Shift+L'], run: () => rightSidebar.showTab('claude') },
  { id: 'claude:new', name: 'Claude: nova conversa', run: () => { rightSidebar.showTab('claude'); claude.newChat(); } },
  { id: 'claude:chats', name: 'Claude: conversas anteriores', run: () => { rightSidebar.showTab('claude'); if (!claude.showList) claude.toggleList(); } },
  { id: 'app:toggle-right-sidebar', name: 'Recolher/expandir barra lateral direita', hotkeys: ['Mod+Shift+B'], run: () => rightSidebar.toggle() },
  { id: 'file:new', name: 'Nova nota', hotkeys: ['Mod+N'], run: () => workspace.createNote() },
  { id: 'file:new-folder', name: 'Nova pasta', run: () => explorer.newFolder() },
  { id: 'canvas:new', name: 'Novo canvas', run: () => workspace.createCanvas() },
  { id: 'drawing:new', name: 'Novo desenho (estilo Excalidraw)', run: () => workspace.createDrawing() },
  { id: 'diagram:new', name: 'Novo diagrama (fluxograma, UML, rede…)', run: () => workspace.createDiagram() },
  { id: 'file:rename', name: 'Renomear nota', hotkeys: ['F2'], check: noteView, run: () => noteView().focusTitle() },
  { id: 'file:delete', name: 'Excluir nota', check: noteView, run: () => workspace.deletePath(noteView().path) },
  { id: 'editor:save', name: 'Salvar nota', hotkeys: ['Mod+S'], check: textView, run: () => textView().save() },
  { id: 'editor:toggle-mode', name: 'Alternar edição/leitura', hotkeys: ['Mod+E'], check: textView, run: () => textView().toggleMode() },
  { id: 'note:history', name: 'Histórico de versões da nota', check: textView, run: () => textView().showHistory() },
  { id: 'note:export-pdf', name: 'Exportar nota para PDF', check: textView, run: () => textView().exportPdf() },
  { id: 'app:toggle-theme', name: 'Alternar tema claro/escuro', run: () => prefs.set('theme', document.body.classList.contains('theme-light') ? 'dark' : 'light') },
  { id: 'graph:open', name: 'Abrir visualização em gráfico', hotkeys: ['Mod+G'], run: () => workspace.openGraph() },
  { id: 'workspace:new-tab', name: 'Nova aba', hotkeys: ['Mod+T'], run: () => workspace.newTab() },
  { id: 'workspace:close', name: 'Fechar aba', hotkeys: ['Mod+W'], check: view, run: () => workspace.closeView(view()) },
  { id: 'workspace:next-tab', name: 'Próxima aba', hotkeys: ['Mod+Tab'], run: () => workspace.cycle(1) },
  { id: 'workspace:previous-tab', name: 'Aba anterior', hotkeys: ['Mod+Shift+Tab'], run: () => workspace.cycle(-1) },
  { id: 'workspace:split-right', name: 'Dividir à direita', run: () => workspace.split('row') },
  { id: 'workspace:split-down', name: 'Dividir abaixo', run: () => workspace.split('column') },
  { id: 'workspace:open-right', name: 'Abrir nota atual à direita', check: noteView, run: () => workspace.splitView(noteView(), 'row') },
  { id: 'workspace:next-pane', name: 'Ir para o próximo painel', run: () => {
    const panes = workspace.panes;
    const next = panes[(panes.indexOf(workspace.activePane) + 1) % panes.length];
    if (next.active) workspace.activate(next.active);
  } },
  { id: 'workspace:pin', name: 'Fixar/desafixar aba', check: view, run: () => workspace.togglePin(view()) },
  { id: 'workspace:close-others', name: 'Fechar as outras abas', check: view, run: () => workspace.closeOthers(view()) },
  { id: 'app:go-back', name: 'Voltar', hotkeys: ['Alt+ArrowLeft'], check: noteView, run: () => noteView().go(-1) },
  { id: 'app:go-forward', name: 'Avançar', hotkeys: ['Alt+ArrowRight'], check: noteView, run: () => noteView().go(1) },
  { id: 'sync:now', name: 'Sincronizar agora', run: syncNow },
  { id: 'daily:today', name: 'Abrir nota diária de hoje', hotkeys: ['Alt+D'], run: () => openDailyNote({ workspace, store }) },
  { id: 'daily:yesterday', name: 'Abrir nota diária de ontem', run: () => openDailyNote({ workspace, store }, -1) },
  { id: 'daily:tomorrow', name: 'Abrir nota diária de amanhã', run: () => openDailyNote({ workspace, store }, 1) },
  { id: 'daily:previous', name: 'Nota diária anterior', run: () => openAdjacentDaily({ workspace, store }, -1) },
  { id: 'daily:next', name: 'Próxima nota diária', run: () => openAdjacentDaily({ workspace, store }, 1) },
  { id: 'template:insert', name: 'Inserir modelo', hotkeys: ['Alt+T'], check: () => editorView(), run: () => insertTemplate({ store, view: editorView() }) },
  { id: 'note:unique', name: 'Nova nota única (data e hora)', run: () => createUniqueNote({ workspace, store }) },
  { id: 'bookmark:toggle', name: 'Favoritar/desfavoritar nota', check: noteView, run: () => bookmarks.toggleFile(noteView().path) },
  { id: 'bookmark:search', name: 'Favoritar a busca atual', check: () => search.input.value.trim(), run: () => bookmarks.addSearch(search.input.value) },
  { id: 'bookmarks:open', name: 'Mostrar favoritos', run: () => showLeftPane('bookmarks') },
  { id: 'app:settings', name: 'Abrir configurações', hotkeys: ['Mod+,'], run: () => openSettings() },
].forEach((command) => commands.add(command));

workspace.addEventListener('search', ({ detail }) => {
  showLeftPane('search');
  search.setQuery(detail);
});
// Formatting and editing commands act on the active note's editor (not in reading mode).
const editorView = () => (textView()?.mode === 'source' ? textView() : null);
for (const [id, name, hotkeys, fn] of EDITOR_COMMANDS) {
  commands.add({ id: `editor:${id}`, name, hotkeys, check: editorView, run: () => fn(editorView().editor) });
}

// Editor look from the preferences (font size, readable line width).
function applyEditorLook() {
  document.body.style.setProperty('--editor-font-size', `${prefs.get('fontSize')}px`);
  document.body.classList.toggle('readable-line-length', prefs.get('readableLineLength'));
  document.body.classList.toggle('show-line-numbers', prefs.get('lineNumbers'));
  document.body.classList.toggle('fold-gutter', prefs.get('foldGutter'));
}
applyEditorLook();
prefs.addEventListener('change', applyEditorLook);

commands.addEventListener('error', ({ detail }) => notice(detail, { error: true }));
window.addEventListener('keydown', (event) => commands.handleKeydown(event), true);

// ---------- chrome: ribbon, sidebar, explorer toolbar ----------

const run = (id) => () => commands.run(id);
$('#ribbon-top').append(iconButton('panel-left', 'Recolher/expandir barra lateral', toggleSidebar));
$('#ribbon-actions').append(
  iconButton('switcher', 'Abrir troca rápida (Ctrl+O)', run('switcher:open')),
  iconButton('graph', 'Abrir visualização em gráfico (Ctrl+G)', run('graph:open')),
  iconButton('file-plus', 'Nova nota (Ctrl+N)', run('file:new')),
  iconButton('calendar', 'Abrir nota diária de hoje (Alt+D)', run('daily:today')),
  iconButton('canvas', 'Novo canvas', run('canvas:new')),
  iconButton('pen-tool', 'Novo desenho', run('drawing:new')),
  iconButton('workflow', 'Novo diagrama', run('diagram:new')),
  iconButton('sparkles', 'Conversar com o Claude (Ctrl+Shift+L)', run('claude:open')),
  iconButton('terminal', 'Abrir paleta de comandos (Ctrl+P)', run('app:command-palette')),
  iconButton('refresh', 'Sincronizar agora', syncNow),
);
$('#ribbon-bottom').append(iconButton('settings', 'Configurações (Ctrl+,)', () => openSettings()));

// Left sidebar tabs: file explorer and search.
const sidebarTabs = {
  files: iconButton('files', 'Arquivos', () => showLeftPane('files')),
  search: iconButton('search', 'Buscar (Ctrl+Shift+F)', () => showLeftPane('search')),
  bookmarks: iconButton('bookmark', 'Favoritos', () => showLeftPane('bookmarks')),
};

function showLeftPane(pane) {
  document.body.classList.remove('is-left-sidebar-collapsed');
  for (const [name, button] of Object.entries(sidebarTabs)) button.classList.toggle('is-active', name === pane);
  $('#files-pane').hidden = pane !== 'files';
  $('#search-pane').hidden = pane !== 'search';
  $('#bookmarks-pane').hidden = pane !== 'bookmarks';
  if (pane === 'search') search.focus();
}

$('#sidebar-tabs').append(sidebarTabs.files, sidebarTabs.search, sidebarTabs.bookmarks);
renderBookmarks($('#bookmarks-pane'), { bookmarks, workspace, store });
showLeftPane('files');
$('#explorer-actions').append(
  iconButton('file-plus', 'Nova nota', () => workspace.createNote()),
  iconButton('folder-plus', 'Nova pasta', () => explorer.newFolder()),
  iconButton('arrow-up-down', 'Ordenar', (event) => {
    const r = event.currentTarget.getBoundingClientRect();
    explorer.sortMenu(r.left, r.bottom + 4);
  }),
  iconButton('chevrons-down-up', 'Recolher tudo', () => explorer.collapseAll()),
);
$('#vault-switcher').append(iconButton('settings', 'Configurações', () => openSettings()));

// The main process holds the window open until every tab has written its text.
api.onBeforeClose(async () => {
  try {
    await workspace.saveAll();
  } finally {
    api.closeReady();
  }
});

// ---------- main process events ----------

api.onSyncStatus(renderSyncStatus);
api.onConflict(({ path, copy }) => {
  notice(`Conflito em "${path}": a versão do outro dispositivo foi salva como "${copy}".`, { timeout: 0 });
});
api.onVaultChanged(async (paths) => {
  await store.refresh(paths);
  await workspace.vaultChanged();
});

// ---------- start ----------

(async () => {
  renderSyncStatus(await api.syncStatus());
  const cfg = await api.getConfig();
  if (!cfg.vaultPath) {
    workspace.reset();
    await openSettings();
    return;
  }
  $('#vault-name').textContent = vaultName(cfg);
  claude.setVault(cfg.vaultPath);
  await store.refresh();
  workspace.restore();
  if (prefs.get('dailyOnStart')) openDailyNote({ workspace, store });
})();
