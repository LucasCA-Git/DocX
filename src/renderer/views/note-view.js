import { EditorView } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { editorExtensions, applyPref } from '../editor-setup';
import { Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { livePreviewPlugin, markdownHighlight, refreshLivePreview } from '../live-preview';
import { linkAt } from '../../shared/links';
import { wikilinkQuery, wikilinkTail, suggestFiles, linkTextFor } from '../../shared/link-suggest';
import { assetUrl } from '../../shared/asset-url';
import {
  el, icon, iconButton, TEXT_FILE, IMAGE_FILE, baseName, dirName, displayName, joinPath, errorText, uniquePath,
} from '../dom';
import { renderMarkdown } from '../markdown';
import { showMenu } from '../context-menu';
import { notice, renderDocStats } from '../status';
import { openHistory } from '../history-modal';
import { fillEmbeds, noteEmbed } from '../embeds';
import { enhanceRendered } from '../render-extras';
import { toggleTask } from '../../shared/markdown-extras';
import { codeLanguages } from '../languages';
import { ExtendedMarkdown } from '../../shared/md-extensions';
import { propertiesField, blocksField } from '../lp-blocks';
import { renderProperties } from '../properties';
import { parseFrontMatter } from '../../shared/metadata';
import { fuzzySort } from '../../shared/fuzzy';
import { prefs } from '../prefs';

const api = window.docs;
const SAVE_DELAY_MS = 800;
const MAX_SUGGESTIONS = 50;

// Inside code (fenced, indented or inline) [[ ]] is literal text, not a link.
function inCode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code/.test(node.name)) return true;
  }
  return false;
}

const wikilinkMark = Decoration.mark({ class: 'cm-wikilink' });

// Marks [[links]] in the editor so they read as clickable (Ctrl+click follows them). Rebuilt when
// the syntax tree changes, since opening a code fence turns the links below it into text.
const wikilinkMarks = ViewPlugin.fromClass(class {
  constructor(view) {
    this.matcher = new MatchDecorator({
      regexp: /!?\[\[[^[\]\n]+?\]\]/g,
      decorate: (add, from, to, _match, v) => {
        if (!inCode(v.state, from)) add(from, to, wikilinkMark);
      },
    });
    this.decorations = this.matcher.createDeco(view);
  }

  update(update) {
    this.decorations = syntaxTree(update.startState) === syntaxTree(update.state)
      ? this.matcher.updateDeco(update, this.decorations)
      : this.matcher.createDeco(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

// One tab showing a file: header (back/forward, breadcrumb, actions) and either the editor or the
// reading view. Keeps its own history (a workspace leaf).
export class NoteView {
  constructor({ workspace, store, path }) {
    this.workspace = workspace;
    this.store = store;
    this.path = null;
    this.history = [];
    this.historyIndex = -1;
    this.mode = 'source';
    this.dirty = false;
    this.saveTimer = null;
    this.saving = Promise.resolve(true);
    this.loadToken = 0;
    // Autocomplete tracks sources by identity, so the [[ source is created once per view.
    const completeLink = (context) => this.completeLink(context);
    this.linkCompletion = EditorState.languageData.of(() => [{ autocomplete: completeLink }]);
    this.propertyHandlers = {
      onTag: (tag) => this.workspace.searchFor(`tag:#${tag}`),
      onLink: (href, event) => this.workspace.openLink(href, this.path, { newTab: event.ctrlKey || event.metaKey }),
      resolve: (target) => this.store.resolve(target, this.path),
    };
    this.properties = propertiesField(this.propertyHandlers);
    this.blocks = blocksField({ resolve: (target) => this.store.resolve(target, this.path) });
    this.lpCompartment = new Compartment();
    this.livePreview = livePreviewPlugin({
      embedNote: (path, subpath) => noteEmbed(path, subpath, { store: this.store, workspace: this.workspace, depth: 0, seen: new Set([this.path]) }),
      version: () => this.store.version,
      resolve: (target) => this.store.resolve(target, this.path),
      open: (href, options) => this.workspace.openLink(href, this.path, options),
    });

    this.backBtn = iconButton('arrow-left', 'Voltar', () => this.go(-1));
    this.forwardBtn = iconButton('arrow-right', 'Avançar', () => this.go(1));
    this.breadcrumb = el('div', { class: 'view-header-title' });
    this.modeBtn = iconButton('book-open', 'Modo leitura (Ctrl+E)', () => this.toggleMode());
    this.header = el('div', { class: 'view-header' },
      el('div', { class: 'view-header-nav' }, this.backBtn, this.forwardBtn),
      this.breadcrumb,
      el('div', { class: 'view-actions' },
        this.modeBtn,
        iconButton('more', 'Mais opções', (e) => this.openMenu(e))));

    this.titleInput = el('input', { class: 'inline-title', spellcheck: 'false', title: 'Renomear' });
    this.titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.editor.focus();
      }
      if (event.key === 'Escape') {
        this.titleInput.value = displayName(this.path);
        this.editor.focus();
      }
    });
    this.titleInput.addEventListener('change', () => this.rename(this.titleInput.value));

    this.editorHost = el('div', { class: 'editor-host' });
    this.reading = el('article', { class: 'markdown-reading', hidden: true });
    this.reading.addEventListener('click', (event) => this.onLinkClick(event));
    this.sizer = el('div', { class: 'note-sizer' }, this.titleInput, this.editorHost, this.reading);
    this.unsupported = el('div', { class: 'empty-state', hidden: true });
    this.content = el('div', { class: 'view-content' }, this.sizer, this.unsupported);
    this.el = el('div', { class: 'view note-view' }, this.header, this.content);

    this.editor = new EditorView({ parent: this.editorHost, state: this.editorState('') });
    this.onPrefs = ({ detail }) => this.onPrefChange(detail.key);
    prefs.addEventListener('change', this.onPrefs);
    if (prefs.get('defaultMode') === 'reading') this.mode = 'reading';
    // New or deleted files change which links resolve.
    this.onStoreChange = () => this.editor.dispatch({ effects: refreshLivePreview.of(null) });
    store.addEventListener('change', this.onStoreChange);
    store.addEventListener('links', this.onStoreChange);
    if (path) this.navigate(path);
  }

  // Live Preview (formatting, properties table, rendered blocks) or plain Markdown source.
  livePreviewExtensions() {
    return prefs.get('livePreview') ? [this.properties, this.blocks, this.livePreview] : [];
  }

  onPrefChange(key) {
    if (key === 'livePreview') this.editor.dispatch({ effects: this.lpCompartment.reconfigure(this.livePreviewExtensions()) });
    else applyPref(this.editor, key);
  }

  get type() { return 'note'; }

  get title() { return this.path ? displayName(this.path) : 'Nova aba'; }

  get iconName() { return 'file-text'; }

  get isText() { return Boolean(this.path && TEXT_FILE.test(this.path)); }

  // A note opens with the cursor after its front matter, so the properties table shows.
  editorState(doc, { anchor = null } = {}) {
    const fm = parseFrontMatter(doc);
    const start = anchor ?? (fm.data ? Math.min(fm.to + 1, doc.length) : 0);
    return EditorState.create({
      doc,
      selection: { anchor: Math.min(start, doc.length) },
      extensions: [
        editorExtensions(),
        markdown({ base: markdownLanguage, codeLanguages, extensions: ExtendedMarkdown }),
        markdownHighlight,
        this.lpCompartment.of(this.livePreviewExtensions()),
        EditorView.lineWrapping,
        wikilinkMarks,
        this.linkCompletion,
        EditorView.domEventHandlers({
          mousedown: (event, view) => this.onEditorClick(event, view),
          paste: (event, view) => this.onPaste(event, view),
          drop: (event, view) => this.onDrop(event, view),
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          this.dirty = true;
          this.scheduleSave();
          renderDocStats(update.state.doc.toString());
        }),
      ],
    });
  }

  // ---------- navigation ----------

  // Leaving a note only happens once its text is safely written; a failed save keeps it open.
  async navigate(path) {
    if (path === this.path) return true;
    if (!(await this.save())) return false;
    if (!(await this.load(path))) {
      if (!this.path) this.showMissing(path);
      return false;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(path);
    this.historyIndex = this.history.length - 1;
    this.renderHeader();
    return true;
  }

  // A history entry already open in another tab switches to that tab instead of opening the note
  // twice (two editors of one file would overwrite each other's saves).
  async go(delta) {
    const next = this.historyIndex + delta;
    if (next < 0 || next >= this.history.length) return;
    const other = this.workspace.views.find((v) => v !== this && v.type === 'note' && v.path === this.history[next]);
    if (other) {
      this.workspace.activate(other);
      return;
    }
    if (!(await this.save())) return;
    if (await this.load(this.history[next])) {
      this.historyIndex = next;
      this.renderHeader();
    }
  }

  // this.path switches only after the new content arrived, so a save in between still targets
  // the note whose text is in the editor.
  async load(path) {
    const token = ++this.loadToken;
    let text = null;
    if (TEXT_FILE.test(path)) {
      try {
        text = await api.read(path);
      } catch (err) {
        if (token === this.loadToken) notice(err, { error: true });
        return false;
      }
      if (token !== this.loadToken) return false;
      if (this.dirty && !(await this.save())) return false;
      if (token !== this.loadToken) return false;
    }
    this.path = path;
    this.dirty = false;
    this.renderHeader();
    this.titleInput.value = displayName(path);
    if (text === null) {
      this.showUnsupported();
    } else {
      this.editor.setState(this.editorState(text));
      this.renderMode();
      if (this.pendingReveal?.path === path) this.reveal(this.pendingReveal.at);
    }
    this.pendingReveal = null;
    this.workspace.viewChanged(this);
    return true;
  }

  renderHeader() {
    if (this.path) this.el.dataset.sourcePath = this.path;
    const dir = this.path ? dirName(this.path) : '';
    this.breadcrumb.replaceChildren(
      ...(dir ? [el('span', { class: 'view-header-breadcrumb', text: dir.split('/').join(' / ') }), el('span', { class: 'view-header-breadcrumb-separator', text: '/' })] : []),
      el('span', { class: 'view-header-title-text', text: this.path ? displayName(this.path) : '' }),
    );
    this.backBtn.disabled = this.historyIndex <= 0;
    this.forwardBtn.disabled = this.historyIndex >= this.history.length - 1;
  }

  showMissing(path) {
    this.sizer.hidden = true;
    this.unsupported.hidden = false;
    this.modeBtn.hidden = true;
    this.unsupported.replaceChildren(
      icon('warning', 40),
      el('p', { text: `Não foi possível abrir "${displayName(path)}".` }),
    );
  }

  showUnsupported() {
    this.sizer.hidden = true;
    this.unsupported.hidden = false;
    this.modeBtn.hidden = true;
    if (IMAGE_FILE.test(this.path)) {
      this.unsupported.replaceChildren(
        el('img', { class: 'image-view', src: assetUrl(this.path), alt: baseName(this.path) }),
        el('p', { class: 'muted', text: baseName(this.path) }),
      );
    } else {
      this.unsupported.replaceChildren(
        icon('file-text', 40),
        el('p', { text: baseName(this.path) }),
        el('p', { class: 'muted', text: 'Este arquivo é sincronizado, mas não é editável aqui.' }),
      );
    }
    renderDocStats(null);
  }

  // Shows `at` = { line (0-based), from?, to? (columns) } of `path` — a search hit, a backlink
  // line — once that note is loaded. Lines, not offsets: the editor turns CRLF into LF.
  revealWhenLoaded(path, at) {
    if (this.path === path && this.loadToken && this.isText) this.reveal(at);
    else this.pendingReveal = { path, at };
  }

  reveal({ line, from = 0, to = from }) {
    if (this.mode === 'reading') this.toggleMode();
    // Focus first, so Live Preview already shows the cursor line raw when the selection lands.
    this.editor.focus();
    const { doc } = this.editor.state;
    const target = doc.line(Math.min(Math.max(line + 1, 1), doc.lines));
    const anchor = target.from + Math.min(from, target.length);
    const head = target.from + Math.min(to, target.length);
    this.editor.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
  }

  // ---------- modes ----------

  toggleMode() {
    if (!this.isText) return;
    this.mode = this.mode === 'source' ? 'reading' : 'source';
    this.renderMode();
    if (this.mode === 'source') this.editor.focus();
  }

  renderMode() {
    this.sizer.hidden = false;
    this.unsupported.hidden = true;
    this.modeBtn.hidden = false;
    const reading = this.mode === 'reading';
    this.editorHost.hidden = reading;
    this.reading.hidden = !reading;
    this.titleInput.readOnly = reading;
    this.modeBtn.replaceChildren(icon(reading ? 'pencil' : 'book-open'));
    this.modeBtn.title = reading ? 'Editar (Ctrl+E)' : 'Modo leitura (Ctrl+E)';
    if (reading) this.renderReading();
    renderDocStats(this.text());
  }

  renderReading() {
    const text = this.text();
    const fm = parseFrontMatter(text);
    const body = el('div');
    body.innerHTML = renderMarkdown(fm.data ? text.slice(fm.to) : text, (target) => this.store.resolve(target, this.path));
    this.reading.replaceChildren(...(fm.data ? [renderProperties(fm.data, this.propertyHandlers)] : []), ...body.childNodes);
    enhanceRendered(this.reading, {
      onTask: (index) => {
        this.applyText(toggleTask(this.text(), index));
        this.renderReading();
      },
    });
    fillEmbeds(this.reading, { store: this.store, workspace: this.workspace, depth: 0, seen: new Set([this.path]) });
  }

  onLinkClick(event) {
    const link = event.target.closest('a');
    if (!link || link.closest('.metadata-container')) return;
    event.preventDefault();
    if (link.getAttribute('href')?.startsWith('#') && link.getAttribute('href') !== '#' && link.dataset.href === undefined && link.dataset.tag === undefined) return;
    if (link.dataset.tag !== undefined) {
      this.workspace.searchFor(`tag:#${link.dataset.tag}`);
      return;
    }
    const href = link.dataset.href;
    if (href !== undefined) {
      this.workspace.openLink(href, this.path, { newTab: event.ctrlKey || event.metaKey });
    } else if (/^https?:\/\//.test(link.href)) {
      window.open(link.href);
    }
  }

  // Ctrl+click on a [[link]] follows it (Ctrl+Shift+click opens a new tab). Only clicks on the
  // marked link count, so code and the margin next to a link are ignored.
  onEditorClick(event, view) {
    if (event.button !== 0) return false;
    // A #tag opens the tag search, unless the cursor is already on its line (then it is edited).
    const tag = event.target.closest?.('.lp-tag');
    if (tag) {
      const pos = view.posAtDOM(tag);
      const line = view.state.doc.lineAt(pos);
      const { head } = view.state.selection.main;
      if (event.ctrlKey || event.metaKey || !view.hasFocus || head < line.from || head > line.to) {
        event.preventDefault();
        this.workspace.searchFor(`tag:#${tag.dataset.tag}`);
        return true;
      }
    }
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (!event.target.closest?.('.cm-wikilink')) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (pos === null) return false;
    const line = view.state.doc.lineAt(pos);
    const link = linkAt(line.text, pos - line.from);
    if (!link) return false;
    event.preventDefault();
    const href = link.target + (link.subpath ? `#${link.subpath}` : '');
    this.workspace.openLink(href, this.path, { newTab: event.shiftKey });
    return true;
  }

  // Suggestions after [[: picking one replaces the whole link name (also the part after the
  // cursor), writes the shortest text that resolves to the file and closes the brackets (or jumps
  // over the "]]" already there).
  completeLink(context) {
    if (inCode(context.state, context.pos)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const tagQuery = before.match(/(?:^|[\s(,;])#([\p{L}\p{N}_\-/]*)$/u);
    if (tagQuery && !/^#+$/.test(before.trim())) return this.completeTag(context, tagQuery[1]);
    const sub = before.match(/\[\[([^[\]|#\n]*)#(\^?)([^[\]|#\n]*)$/);
    if (sub) return this.completeSubpath(context, line, sub);
    const query = wikilinkQuery(before);
    if (!query) return null;
    const { length, closed } = wikilinkTail(line.text.slice(context.pos - line.from));
    const options = suggestFiles(this.store.files, query.query).slice(0, MAX_SUGGESTIONS).map((rel) => ({
      label: /\.md$/i.test(rel) ? displayName(rel) : baseName(rel),
      detail: dirName(rel),
      type: IMAGE_FILE.test(rel) ? 'image' : 'note',
      apply: (view, _completion, from, to) => {
        const insert = linkTextFor(rel, this.store.index.lookup, this.path) + (closed ? '' : ']]');
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } });
      },
    }));
    // Aliases from the notes' front matter: inserting writes [[note|alias]].
    if (query.query && !query.embed) {
      const aliasEntries = [];
      for (const [rel, aliases] of this.store.index.aliases) for (const alias of aliases) aliasEntries.push({ rel, alias });
      for (const { item } of fuzzySort(query.query, aliasEntries, (e) => e.alias).slice(0, 20)) {
        options.push({
          label: item.alias,
          detail: `↳ ${displayName(item.rel)}`,
          type: 'alias',
          boost: -1,
          apply: (view, _completion, from, to) => {
            const insert = `${linkTextFor(item.rel, this.store.index.lookup, this.path)}|${item.alias}${closed ? '' : ']]'}`;
            view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } });
          },
        });
      }
    }
    return { from: line.from + query.from, to: context.pos + length, options, filter: false };
  }

  // After [[note# — the note's headings; after [[note#^ — its block ids.
  completeSubpath(context, line, [, name, caret, query]) {
    const rel = name ? this.store.resolve(name, this.path) : this.path;
    const meta = rel ? this.store.index.metadata(rel) : null;
    if (!meta) return null;
    const { length, closed } = wikilinkTail(line.text.slice(context.pos - line.from));
    const items = caret ? meta.blocks.map((b) => ({ label: b.id, detail: `linha ${b.line + 1}` }))
      : meta.headings.map((h) => ({ label: h.text, detail: 'H' + h.level }));
    const found = query ? fuzzySort(query, items, (i) => i.label).map((r) => r.item) : items;
    if (!found.length) return null;
    return {
      from: context.pos - query.length,
      to: context.pos + length,
      filter: false,
      options: found.slice(0, MAX_SUGGESTIONS).map((item) => ({
        label: item.label,
        detail: item.detail,
        type: caret ? 'block' : 'heading',
        apply: (view, _c, from, to) => {
          const insert = item.label + (closed ? '' : ']]');
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } });
        },
      })),
    };
  }

  // #tag suggestions from every tag in the vault.
  completeTag(context, query) {
    const tags = this.store.index.tagCounts();
    const found = query ? fuzzySort(query, tags, (t) => t.tag).map((r) => r.item) : tags.sort((a, b) => b.count - a.count);
    if (!found.length) return null;
    return {
      from: context.pos - query.length,
      options: found.slice(0, MAX_SUGGESTIONS).map((t) => ({ label: t.tag, detail: String(t.count), type: 'tag' })),
      filter: false,
    };
  }

  text() {
    return this.editor.state.doc.toString();
  }

  // ---------- attachments: paste and drop ----------

  onPaste(event, view) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length || !this.isText) return false;
    event.preventDefault();
    this.insertAttachments(files, view.state.selection.main.from, view.state.selection.main.to, { pasted: true });
    return true;
  }

  onDrop(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    const dragged = event.dataTransfer?.getData('application/x-docs-path');
    if (dragged) {
      // A file dragged from the explorer becomes a link to it.
      event.preventDefault();
      const isFolder = this.store.folders.includes(dragged);
      if (isFolder) return true;
      const link = `${IMAGE_FILE.test(dragged) ? '!' : ''}[[${linkTextFor(dragged, this.store.index.lookup, this.path)}]]`;
      view.dispatch({ changes: { from: pos, insert: link }, selection: { anchor: pos + link.length } });
      view.focus();
      return true;
    }
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length || !this.isText) return false;
    event.preventDefault();
    this.insertAttachments(files, pos, pos, { pasted: false });
    return true;
  }

  // Copies the files into the attachments folder and inserts ![[ ]] for each one.
  async insertAttachments(files, from, to, { pasted }) {
    const path = this.path;
    const setting = prefs.get('attachmentFolder').trim().replace(/^\/+|\/+$/g, '');
    const folder = setting.startsWith('.') ? joinPath(dirName(this.path), setting.replace(/^\.\/?/, '')) : setting;
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const created = [];
    for (const file of files) {
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? (file.type.startsWith('image/') ? `.${file.type.slice(6).replace('jpeg', 'jpg').replace('svg+xml', 'svg')}` : '')).toLowerCase();
      const stem = pasted && /^image\.\w+$/i.test(file.name) ? `Pasted image ${stamp}` : file.name.replace(/\.[^.]+$/, '').replace(/[\\/#|[\]^]/g, '-') || `Arquivo ${stamp}`;
      const rel = uniquePath(folder, stem, ext, [...this.store.files, ...created]);
      try {
        await api.createBinary(rel, new Uint8Array(await file.arrayBuffer()));
        created.push(rel);
      } catch (err) {
        notice(`Não foi possível salvar "${file.name}": ${errorText(err)}`, { error: true });
      }
    }
    if (!created.length) return;
    await this.store.refresh();
    // Another note was opened meanwhile: the files are saved, the links are not inserted there.
    if (this.path !== path) {
      notice(`${created.length === 1 ? 'Anexo salvo' : 'Anexos salvos'} em "${dirName(created[0]) || '/'}".`);
      return;
    }
    const insert = created.map((rel) => `${IMAGE_FILE.test(rel) || /\.(pdf|mp3|wav|ogg|m4a|mp4|webm)$/i.test(rel) ? '!' : ''}[[${linkTextFor(rel, this.store.index.lookup, path)}]]`).join('\n');
    // The text may have changed while copying: insert at the cursor if the old range is gone.
    const length = this.editor.state.doc.length;
    const at = from <= length && to <= length ? { from, to } : this.editor.state.selection.main;
    this.editor.dispatch({ changes: { from: at.from, to: at.to, insert }, selection: { anchor: at.from + insert.length } });
  }

  // ---------- saving ----------

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  // Saves run one after another (never two writes of the same file at once). The text is
  // captured now, so a save requested right before closing still has it. Resolves to false when
  // the write failed and the text exists only in the editor.
  save() {
    clearTimeout(this.saveTimer);
    const snapshot = this.path && this.dirty && this.isText ? { path: this.path, text: this.text() } : null;
    this.saving = this.saving.then(() => (snapshot ? this.write(snapshot) : true));
    return this.saving;
  }

  async write({ path, text }) {
    try {
      await api.write(path, text);
      if (this.path === path && this.text() === text) this.dirty = false;
      this.store.updateNote(path, text);
      return true;
    } catch (err) {
      notice(`Erro ao salvar "${displayName(path)}": ${errorText(err)}`, { error: true });
      return false;
    }
  }

  // Waits for saves already sent, without starting a new one (used before delete).
  flushed() {
    clearTimeout(this.saveTimer);
    return this.saving;
  }

  // Called when files changed on disk (sync download, other editor).
  async reloadIfClean() {
    if (!this.path || this.dirty || !this.isText || !this.store.has(this.path)) return;
    const { path, loadToken } = this;
    const text = await api.read(path);
    if (path !== this.path || loadToken !== this.loadToken || this.dirty || text === this.text()) return;
    const { anchor } = this.editor.state.selection.main;
    this.editor.setState(this.editorState(text, { anchor: Math.min(anchor, text.length) }));
    if (this.mode === 'reading') this.renderReading();
  }

  // ---------- file actions ----------

  async rename(name) {
    const trimmed = name.trim().replace(/[\\/]/g, '-');
    if (!this.path || !trimmed || trimmed === displayName(this.path)) {
      this.titleInput.value = this.path ? displayName(this.path) : '';
      return;
    }
    await this.save();
    const ext = /\.md$/i.test(this.path) ? '.md' : '';
    const to = joinPath(dirName(this.path), `${trimmed}${ext}`);
    try {
      await this.workspace.renamePath(this.path, to);
    } catch (err) {
      this.titleInput.value = displayName(this.path);
      notice(err, { error: true });
    }
  }

  // Path changed by a rename elsewhere (explorer, inline title, folder move).
  pathRenamed(from, to) {
    const map = (p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    this.history = this.history.map(map);
    if (!this.path) return;
    const next = map(this.path);
    if (next === this.path) return;
    this.path = next;
    this.titleInput.value = displayName(next);
    this.renderHeader();
  }

  openMenu(event) {
    if (!this.path) return;
    const rect = event.currentTarget.getBoundingClientRect();
    showMenu([
      { label: 'Renomear', icon: 'pencil', action: () => this.focusTitle() },
      { label: this.mode === 'reading' ? 'Editar' : 'Modo leitura', icon: 'book-open', action: () => this.toggleMode() },
      ...(this.isText ? [
        { label: 'Histórico de versões', icon: 'history', action: () => this.showHistory() },
        { label: 'Exportar para PDF', icon: 'file-down', action: () => this.exportPdf() },
      ] : []),
      { label: this.workspace.bookmarks?.has(this.path) ? 'Remover dos favoritos' : 'Favoritar', icon: 'bookmark', action: () => this.workspace.bookmarks?.toggleFile(this.path) },
      '-',
      { label: 'Excluir arquivo', icon: 'trash', danger: true, action: () => this.workspace.deletePath(this.path) },
    ], rect.left, rect.bottom + 4);
  }

  // Rendered HTML of the note (reading view, with embeds and diagrams finished) for the PDF.
  async exportPdf() {
    if (!this.path || !this.isText) return;
    await this.save();
    const holder = el('div', { class: 'markdown-reading' });
    const text = this.text();
    const fm = parseFrontMatter(text);
    const body = el('div');
    body.innerHTML = renderMarkdown(fm.data ? text.slice(fm.to) : text, (target) => this.store.resolve(target, this.path));
    holder.append(...(fm.data ? [renderProperties(fm.data, this.propertyHandlers)] : []), ...body.childNodes);
    enhanceRendered(holder);
    fillEmbeds(holder, { store: this.store, workspace: this.workspace, depth: 0, seen: new Set([this.path]) });
    // Mermaid draws asynchronously.
    for (let i = 0; i < 50 && holder.querySelector('.mermaid-diagram:not(:has(img, .mermaid-error))'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      const file = await api.exportPdf(holder.innerHTML, displayName(this.path));
      if (file) notice(`PDF salvo em ${file}`);
    } catch (err) {
      notice(err, { error: true });
    }
  }

  showHistory() {
    if (!this.path || !this.isText) return;
    const path = this.path;
    openHistory({
      path,
      currentText: () => this.text(),
      resolve: (target) => this.store.resolve(target, path),
      restore: async (text) => {
        if (this.path !== path) throw new Error('A nota mudou enquanto o histórico estava aberto');
        this.replaceText(text);
        if (!(await this.save())) throw new Error('Não foi possível salvar a versão restaurada');
      },
    });
  }

  // New text as the smallest single change (common start and end kept), so the cursor and the
  // undo history stay sensible.
  applyText(text) {
    const old = this.text();
    let start = 0;
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    let endOld = old.length;
    let endNew = text.length;
    while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) {
      endOld--;
      endNew--;
    }
    this.editor.dispatch({ changes: { from: start, to: endOld, insert: text.slice(start, endNew) } });
  }

  // Whole-text replacement as one editor change, so Ctrl+Z brings the previous text back.
  replaceText(text) {
    if (this.mode === 'reading') this.toggleMode();
    this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: text } });
  }

  focusTitle() {
    this.titleInput.focus();
    this.titleInput.select();
  }

  onShow() {
    renderDocStats(this.isText ? this.text() : null);
  }

  onHide() {
    this.save();
  }

  destroy() {
    this.save();
    this.store.removeEventListener('change', this.onStoreChange);
    this.store.removeEventListener('links', this.onStoreChange);
    prefs.removeEventListener('change', this.onPrefs);
    this.editor.destroy();
  }

  serialize() {
    return { type: 'note', path: this.path };
  }
}
