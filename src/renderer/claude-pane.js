import { el, icon, iconButton, displayName, errorText } from './dom';
import { renderMarkdown } from './markdown';
import { enhanceRendered } from './render-extras';
import { notice, confirmDialog } from './status';
import { prefs } from './prefs';
import { settingRow } from './settings';
import { splitAnswer } from '../shared/claude-actions';
import { diffLines } from '../shared/diff';
import { newChat, chatTitle, loadChats, serializeChats } from '../shared/claude-chats';

const api = window.docs;
// One list of conversations per vault: Claude Code keeps each session with the vault's folder.
const STORAGE_PREFIX = 'docs.claude.chats:';
// Before 1.7 there was a single conversation, for whatever vault was open.
const LEGACY_KEY = 'docs.claude.chat';
const RENDER_INTERVAL_MS = 100;

const ACTION_LABELS = { create: 'Criar', edit: 'Alterar', mkdir: 'Criar pasta' };
const ACTION_ICONS = { create: 'file-plus', edit: 'pencil', mkdir: 'folder-plus' };
const TOOL_LABELS = { Read: 'Lendo', Glob: 'Procurando arquivos', Grep: 'Buscando no vault' };

const formatDate = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

// Claude in the right sidebar: a conversation with the user's Claude Code, which reads the vault
// and proposes files and edits (see shared/claude-actions.js). Nothing is written until the user
// clicks "Aplicar" on a proposal, after seeing its content or its diff.
export class ClaudePane {
  // onMinimize/onRestore hide and show the panel; while it is hidden a floating button stays on
  // screen, showing when Claude is answering or has finished.
  constructor({ workspace, store, openSettings, onMinimize, onRestore }) {
    this.workspace = workspace;
    this.store = store;
    this.openSettings = openSettings;
    this.onMinimize = onMinimize;
    this.onRestore = onRestore;
    this.vaultPath = null;
    this.chats = [];
    this.chat = newChat();
    this.minimized = prefs.get('claudeMinimized');
    // An answer finished while the panel was minimized.
    this.news = false;
    // The answer being written: { runId, message, chat }.
    this.run = null;
    this.views = new Map();
    // File text each edit preview was diffed against: message -> Map(action index -> text).
    this.bases = new WeakMap();

    this.statusEl = el('span', { class: 'claude-status' });
    this.historyBtn = iconButton('panel-left', 'Mostrar/ocultar conversas', () => this.toggleHistory());
    this.searchInput = el('input', { type: 'search', class: 'claude-history-search', placeholder: 'Buscar conversas', 'aria-label': 'Buscar conversas' });
    this.historyItems = el('div', { class: 'claude-history-items' });
    this.historyEl = el('div', { class: 'claude-history' },
      el('button', { class: 'claude-history-new', onclick: () => this.newChat() }, icon('plus', 14), el('span', { text: 'Nova conversa' })),
      this.searchInput,
      this.historyItems);
    this.list = el('div', { class: 'claude-messages' });
    this.contextEl = el('div', { class: 'claude-context' });
    this.input = el('textarea', {
      class: 'claude-input',
      rows: '3',
      placeholder: 'Peça um documento, um resumo, uma edição… (Enter envia, Shift+Enter quebra a linha)',
      'aria-label': 'Mensagem para o Claude',
    });
    this.sendBtn = iconButton('send', 'Enviar (Enter)', () => (this.run ? this.cancel() : this.send()), 'clickable-icon claude-send');
    this.el = el('div', { class: 'claude-pane' },
      this.historyEl,
      el('div', { class: 'claude-main' },
        el('div', { class: 'claude-header' },
          this.historyBtn,
          icon('sparkles', 16), el('strong', { text: 'Claude' }), this.statusEl,
          iconButton('plus', 'Nova conversa', () => this.newChat()),
          iconButton('minus', 'Minimizar', () => this.minimize()),
          iconButton('settings', 'Configurações do Claude', () => this.openSettings())),
        this.list,
        el('div', { class: 'claude-composer' }, this.contextEl, el('div', { class: 'claude-input-row' }, this.input, this.sendBtn))));
    this.bubble = el('button', { class: 'claude-fab', title: 'Abrir o Claude (Ctrl+Shift+L)', 'aria-label': 'Abrir o Claude', hidden: true, onclick: () => this.restore() },
      icon('sparkles', 20), el('span', { class: 'claude-fab-dot' }));
    document.body.append(this.bubble);

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.send();
      }
    });
    this.list.addEventListener('click', (event) => this.onLinkClick(event));
    this.searchInput.addEventListener('input', () => this.renderHistory());
    api.onClaudeEvent((event) => this.onEvent(event));
    workspace.addEventListener('change', () => this.renderContext());
    // The saved conversation is drawn before the vault loads: its links resolve after the first load.
    store.addEventListener('change', () => this.run || this.renderAll(), { once: true });
    this.renderContext();
    this.applyHistory();
    this.renderAll();
    this.updateBubble();
    this.checkStatus();
  }

  onShow() {
    this.minimized = false;
    this.news = false;
    prefs.set('claudeMinimized', false);
    this.updateBubble();
    setTimeout(() => this.input.focus(), 0);
  }

  // ---------- minimize ----------

  minimize() {
    this.minimized = true;
    prefs.set('claudeMinimized', true);
    this.onMinimize();
    this.updateBubble();
  }

  restore() {
    // Showing the pane runs onShow, which hides the button.
    this.onRestore();
  }

  updateBubble() {
    this.bubble.hidden = !this.minimized;
    this.bubble.classList.toggle('is-busy', Boolean(this.run));
    this.bubble.classList.toggle('has-news', this.news && !this.run);
    this.bubble.title = this.run ? 'O Claude está respondendo… (clique para abrir)' : this.news ? 'O Claude respondeu (clique para abrir)' : 'Abrir o Claude (Ctrl+Shift+L)';
  }

  async checkStatus() {
    this.statusEl.textContent = 'procurando…';
    try {
      this.status = await api.claudeStatus();
    } catch (err) {
      this.status = { found: false, error: errorText(err) };
    }
    this.statusEl.textContent = this.status.found ? (this.status.via === 'wsl' ? 'Claude Code (WSL)' : 'Claude Code') : 'não encontrado';
    this.statusEl.classList.toggle('is-error', !this.status.found);
    this.renderAll();
  }

  // The vault whose conversations the panel shows (at start and after choosing another folder).
  setVault(vaultPath) {
    if (vaultPath === this.vaultPath) return;
    this.stopRun();
    this.vaultPath = vaultPath || null;
    const legacy = vaultPath ? readJson(LEGACY_KEY) : null;
    const { current, chats } = vaultPath ? loadChats(readJson(STORAGE_PREFIX + vaultPath), legacy) : { current: null, chats: [] };
    this.chats = chats;
    this.chat = chats.find((c) => c.id === current) ?? newChat();
    if (legacy && this.save()) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Read again next time; it is already in this vault's list.
      }
    }
    this.renderHistory();
    this.renderAll();
  }

  save() {
    this.renderHistory();
    if (!this.vaultPath) return false;
    try {
      localStorage.setItem(STORAGE_PREFIX + this.vaultPath, JSON.stringify(serializeChats(this.chat.id, this.chats)));
      return true;
    } catch {
      return false;
    }
  }

  // Stops the answer being written and closes it as interrupted; its late events are ignored
  // (they no longer match this.run).
  stopRun() {
    if (!this.run) return;
    this.cancel();
    this.finish(this.run, { cancelled: true });
  }

  newChat() {
    this.stopRun();
    this.chat = newChat();
    this.save();
    this.renderAll();
    this.input.focus();
  }

  openChat(chat) {
    if (chat !== this.chat) {
      this.stopRun();
      this.chat = chat;
      this.save();
    }
    this.renderAll();
    this.input.focus();
  }

  async deleteChat(chat) {
    const ok = await confirmDialog(`Apagar a conversa "${chat.title}"? As notas criadas por ela continuam no vault.`, { confirmLabel: 'Apagar', danger: true });
    if (!ok) return;
    if (this.run?.chat === chat) this.stopRun();
    this.chats = this.chats.filter((c) => c !== chat);
    if (this.chat === chat) this.chat = newChat();
    this.save();
    this.renderAll();
  }

  // ---------- conversation list ----------

  toggleHistory(open = !prefs.get('claudeHistoryOpen')) {
    prefs.set('claudeHistoryOpen', open);
    this.applyHistory();
    if (open) this.searchInput.focus();
  }

  applyHistory() {
    const open = prefs.get('claudeHistoryOpen');
    this.historyEl.hidden = !open;
    this.historyBtn.classList.toggle('is-active', open);
    // The sidebar widens to fit the column (styles.css).
    document.body.classList.toggle('is-claude-history-open', open);
  }

  renderHistory() {
    const query = this.searchInput.value.trim().toLowerCase();
    const matches = (chat) => !query || chat.title.toLowerCase().includes(query) || chat.messages.some((m) => m.text.toLowerCase().includes(query));
    const chats = this.chats.filter((c) => c.id && matches(c)).sort((a, b) => b.updated - a.updated);
    this.historyItems.replaceChildren(...(chats.length ? chats.map((chat) => this.historyItem(chat))
      : [el('p', { class: 'pane-empty', text: query ? 'Nenhuma conversa encontrada.' : 'As conversas deste vault aparecem aqui.' })]));
  }

  historyItem(chat) {
    const title = el('span', { class: 'claude-chat-title', text: chat.title, title: chat.title });
    const item = el('div', {
      class: `claude-chat-item${chat === this.chat ? ' is-active' : ''}`,
      role: 'button',
      tabindex: '0',
      onclick: () => this.openChat(chat),
      onkeydown: (event) => {
        if (event.key === 'Enter' && event.target === item) this.openChat(chat);
      },
    },
    el('div', { class: 'claude-chat-text' },
      title,
      el('span', { class: 'claude-chat-date' }, this.run?.chat === chat ? el('span', { class: 'claude-dots' }) : null, formatDate(chat.updated))),
    el('div', { class: 'claude-chat-buttons' },
      iconButton('pencil', 'Renomear', (event) => {
        event.stopPropagation();
        this.renameChat(chat, title);
      }),
      iconButton('trash', 'Apagar conversa', (event) => {
        event.stopPropagation();
        this.deleteChat(chat);
      })));
    return item;
  }

  renameChat(chat, titleEl) {
    const input = el('input', { type: 'text', class: 'claude-chat-rename', value: chat.title, 'aria-label': 'Nome da conversa' });
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (keep && name) chat.title = name;
      this.save();
    };
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  renderContext() {
    const note = this.workspace.followedNotePath;
    this.contextEl.replaceChildren(...(note ? [icon('file-text', 12), el('span', { text: `Nota aberta: ${displayName(note)}`, title: note })] : []));
  }

  // ---------- conversation ----------

  async send() {
    const text = this.input.value.trim();
    if (!text || this.run || this.sending) return;
    this.sending = true;
    try {
      if (this.status && !this.status.found) await this.checkStatus();
      this.input.value = '';
      // Claude reads the files from disk: unsaved typing goes there first.
      await this.workspace.saveAll();
    } finally {
      this.sending = false;
    }
    const note = this.workspace.followedNotePath;
    const prompt = note ? `${text}\n\n[DocX] Nota aberta agora: ${note}` : text;
    const { chat } = this;
    chat.sessionId ??= crypto.randomUUID();
    if (!chat.id) {
      chat.id = crypto.randomUUID();
      this.chats.unshift(chat);
    }
    const message = { role: 'assistant', text: '', pending: true, actions: {} };
    chat.messages.push({ role: 'user', text }, message);
    chat.title ||= chatTitle(chat.messages);
    chat.updated = Date.now();
    const run = { runId: crypto.randomUUID(), message, chat };
    this.run = run;
    this.save();
    this.renderAll();
    this.setBusy(true);
    try {
      await api.claudeAsk(run.runId, { prompt, sessionId: run.chat.sessionId, resume: run.chat.started, model: prefs.get('claudeModel') });
    } catch (err) {
      this.finish(run, { error: errorText(err) });
    }
  }

  cancel() {
    if (this.run) api.claudeCancel(this.run.runId).catch(() => {});
  }

  setBusy(busy) {
    this.sendBtn.replaceChildren(icon(busy ? 'stop' : 'send'));
    this.sendBtn.title = busy ? 'Parar' : 'Enviar (Enter)';
    this.sendBtn.setAttribute('aria-label', this.sendBtn.title);
    this.updateBubble();
  }

  onEvent(event) {
    if (!this.run || event.runId !== this.run.runId) return;
    const { message } = this.run;
    if (event.type === 'delta') {
      if (event.newBlock && message.text) message.text += '\n\n';
      message.text += event.text;
      message.activity = null;
      this.scheduleRender(message);
    } else if (event.type === 'tool') {
      message.activity = `${TOOL_LABELS[event.name] ?? event.name}${event.detail ? ` ${event.detail}` : ''}…`;
      this.scheduleRender(message);
    } else if (event.type === 'done') {
      this.finish(this.run, event);
    }
  }

  finish(run, { text, error, cancelled }) {
    const { message, chat } = run;
    const failed = Boolean(error || cancelled);
    // A cut answer keeps what was streamed; a finished one takes the complete text.
    if (text && !failed) message.text = text;
    message.pending = false;
    message.activity = null;
    if (error) message.error = error;
    if (cancelled) message.error = 'Interrompido.';
    // The session exists in Claude Code only after a finished answer. Until then a failed try
    // starts over with a new id (the old one may be half-created).
    if (!failed) {
      chat.started = true;
    } else if (!chat.started) {
      chat.sessionId = null;
    } else if (/no conversation found/i.test(error ?? '')) {
      chat.sessionId = null;
      chat.started = false;
      message.error += ' A conversa anterior não está mais no Claude Code; a próxima mensagem começa uma nova.';
    }
    if (this.run === run) {
      this.run = null;
      if (this.minimized && !cancelled) this.news = true;
      this.setBusy(false);
    }
    chat.updated = Date.now();
    this.save();
    this.renderMessage(message);
  }

  scheduleRender(message) {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.renderMessage(message);
    }, RENDER_INTERVAL_MS);
  }

  // ---------- rendering ----------

  renderAll() {
    this.views.clear();
    const nodes = [];
    if (this.status && !this.status.found) nodes.push(this.setupHelp());
    else if (!this.chat.messages.length) nodes.push(this.welcome());
    for (const message of this.chat.messages) nodes.push(this.messageNode(message));
    this.list.replaceChildren(...nodes);
    this.list.scrollTop = this.list.scrollHeight;
  }

  renderMessage(message) {
    const old = this.views.get(message);
    if (!old) {
      // Drawn only when it is on screen.
      if (this.chat.messages.includes(message)) this.renderAll();
      return;
    }
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    old.replaceWith(this.messageNode(message));
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  welcome() {
    return el('div', { class: 'claude-welcome' },
      el('p', { text: 'Peça ao Claude um documento novo, um resumo das suas notas, uma revisão da nota aberta, um canvas ou um diagrama.' }),
      el('p', { class: 'claude-hint', text: 'Ele lê o seu vault e propõe as mudanças; nada é gravado sem você clicar em "Aplicar".' }));
  }

  setupHelp() {
    return el('div', { class: 'claude-welcome' },
      el('p', { text: 'O DocX usa o Claude Code instalado no seu computador, com a sua conta do Claude.' }),
      el('ol', {},
        el('li', { text: 'Instale o Claude Code (no Windows ou dentro do WSL).' }),
        el('li', { text: 'Abra um terminal, rode "claude" e entre com a sua conta.' }),
        el('li', { text: 'Volte aqui e clique em "Tentar de novo".' })),
      this.status?.error ? el('p', { class: 'error', text: this.status.error }) : null,
      el('div', { class: 'buttons' },
        el('button', { class: 'mod-cta', text: 'Tentar de novo', onclick: () => this.checkStatus() }),
        el('button', { text: 'Configurar', onclick: () => this.openSettings() })));
  }

  messageNode(message) {
    let node;
    if (message.role === 'user') {
      node = el('div', { class: 'claude-msg is-user' }, el('div', { class: 'claude-bubble', text: message.text }));
    } else {
      node = el('div', { class: 'claude-msg is-assistant' });
      let actionIndex = 0;
      const pending = [];
      for (const piece of splitAnswer(message.text, { final: !message.pending })) {
        if (piece.kind === 'text') {
          node.append(this.markdown(piece.text));
        } else if (piece.kind === 'action') {
          const index = actionIndex++;
          if (!message.actions?.[index]) pending.push([index, piece.action]);
          node.append(message.pending ? this.streamingCard(piece.action) : this.actionCard(message, index, piece.action));
        } else if (piece.kind === 'invalid') {
          node.append(el('div', { class: 'claude-action is-invalid' }, icon('warning', 14), el('span', { text: `Proposta ignorada: ${piece.error}` })));
        } else {
          node.append(el('div', { class: 'claude-activity', text: 'Escrevendo arquivo…' }));
        }
      }
      if (pending.length > 1 && !message.pending) {
        node.append(el('div', { class: 'buttons claude-apply-all' },
          el('button', { class: 'mod-cta', text: `Aplicar todas (${pending.length})`, onclick: () => this.applyAll(message, pending) })));
      }
      if (message.pending) node.append(el('div', { class: 'claude-activity' }, el('span', { class: 'claude-dots' }), message.activity ?? (message.text ? '' : 'Pensando…')));
      if (message.error) node.append(el('p', { class: 'error', text: message.error }));
    }
    this.views.set(message, node);
    return node;
  }

  markdown(text) {
    const article = el('div', { class: 'markdown-reading claude-text' });
    article.innerHTML = renderMarkdown(text, (target) => this.store.resolve(target, this.workspace.followedNotePath ?? ''));
    // Nothing loads from the internet by itself: a note could ask Claude to put vault text in an
    // image URL. Remote images and media become plain links.
    for (const media of article.querySelectorAll('img, video, audio, source')) {
      const src = media.getAttribute('src') ?? '';
      if (!/^[a-z][a-z0-9+.-]*:/i.test(src) || /^(vault-asset|data):/i.test(src)) continue;
      const link = el('a', { href: src, text: media.getAttribute('alt') || src });
      (media.tagName === 'SOURCE' ? media.parentElement : media).replaceWith(link);
    }
    enhanceRendered(article);
    return article;
  }

  onLinkClick(event) {
    const link = event.target.closest('a');
    if (!link || !this.list.contains(link)) return;
    event.preventDefault();
    const newTab = event.ctrlKey || event.metaKey;
    if (link.classList.contains('internal-link')) this.workspace.openLink(link.dataset.href, this.workspace.followedNotePath ?? '', { newTab });
    else if (link.classList.contains('tag')) this.workspace.searchFor(`tag:#${link.dataset.tag}`);
    else if (/^https?:\/\//.test(link.getAttribute('href') ?? '')) window.open(link.href);
  }

  // While the answer streams: what is coming, without preview or buttons.
  streamingCard(action) {
    return el('div', { class: 'claude-action' },
      el('div', { class: 'claude-action-title' }, icon(ACTION_ICONS[action.type], 14),
        el('span', { text: ACTION_LABELS[action.type] }), el('strong', { text: action.path, title: action.path })),
      el('div', { class: 'claude-activity', text: 'Aguardando o fim da resposta…' }));
  }

  actionCard(message, index, action) {
    const state = message.actions?.[index];
    const preview = el('div', { class: 'claude-preview', hidden: Boolean(state) || action.type === 'mkdir' });
    const toggle = action.type === 'mkdir' || state ? null : iconButton('file-text', 'Mostrar/ocultar prévia', () => {
      preview.hidden = !preview.hidden;
    });
    const buttons = el('div', { class: 'claude-action-buttons' });
    if (state === 'applied') {
      buttons.append(el('span', { class: 'claude-done', text: 'Aplicado' }));
      if (action.type !== 'mkdir') buttons.append(el('button', { text: 'Abrir', onclick: () => this.workspace.openFile(action.path, { newTab: true }) }));
    } else if (state === 'discarded') {
      buttons.append(el('span', { class: 'claude-done', text: 'Descartado' }));
    } else {
      buttons.append(
        el('button', { class: 'mod-cta', text: 'Aplicar', onclick: () => this.apply(message, index, action) }),
        el('button', { text: 'Descartar', onclick: () => this.mark(message, index, 'discarded') }));
    }
    const card = el('div', { class: `claude-action${state ? ` is-${state}` : ''}` },
      el('div', { class: 'claude-action-title' }, icon(ACTION_ICONS[action.type], 14),
        el('span', { text: ACTION_LABELS[action.type] }), el('strong', { text: action.path, title: action.path }), toggle),
      preview, buttons);
    if (!preview.hidden) this.fillPreview(preview, message, index, action);
    return card;
  }

  async fillPreview(host, message, index, action) {
    if (action.type === 'create') {
      host.append(el('pre', { class: 'history-diff', text: action.content }));
      return;
    }
    try {
      const base = await api.read(action.path);
      if (!this.bases.has(message)) this.bases.set(message, new Map());
      this.bases.get(message).set(index, base);
      const parts = diffLines(base, action.content);
      if (parts.every((p) => p.type === 'equal')) {
        host.append(el('p', { class: 'pane-empty', text: 'Sem mudanças.' }));
        return;
      }
      // Only the changes, with two lines around each.
      const near = (i) => parts.slice(Math.max(0, i - 2), i + 3).some((q) => q.type !== 'equal');
      host.append(el('pre', { class: 'history-diff' }, parts.filter((_, i) => near(i)).map((p) => el('div', {
        class: `diff-line diff-${p.type}`,
        text: `${p.type === 'added' ? '+ ' : p.type === 'removed' ? '− ' : '  '}${p.text}`,
      }))));
    } catch (err) {
      host.append(el('p', { class: 'error', text: `Não foi possível ler "${action.path}": ${errorText(err)}` }));
    }
  }

  mark(message, index, state) {
    message.actions ??= {};
    message.actions[index] = state;
    this.save();
    this.renderMessage(message);
  }

  async apply(message, index, action, { open = true } = {}) {
    try {
      if (!(await this.write(action, this.bases.get(message)?.get(index)))) return false;
    } catch (err) {
      notice(`${ACTION_LABELS[action.type]} "${action.path}": ${errorText(err)}`, { error: true });
      return false;
    }
    this.mark(message, index, 'applied');
    if (open && action.type !== 'mkdir') this.workspace.openFile(action.path, { newTab: true });
    return true;
  }

  async applyAll(message, pending) {
    let opened = false;
    for (const [index, action] of pending) {
      if (message.actions?.[index]) continue;
      const ok = await this.apply(message, index, action, { open: !opened });
      if (ok && action.type !== 'mkdir') opened = true;
    }
  }

  // -> false when the user gave up (the file changed after the preview).
  async write(action, base) {
    const exists = this.store.has(action.path);
    if (action.type === 'mkdir') {
      if (!this.store.folders.includes(action.path)) await api.mkdir(action.path);
    } else if (action.type === 'create') {
      if (exists) throw new Error('o arquivo já existe');
      await api.create(action.path);
      try {
        await api.write(action.path, action.content);
      } catch (err) {
        // No empty file left behind: "Aplicar" can be tried again.
        await api.remove(action.path).catch(() => {});
        throw err;
      }
    } else {
      if (!exists) throw new Error('o arquivo não existe');
      // Unsaved typing in an open tab is written first, so the reload below shows Claude's version.
      if (!(await this.workspace.saveAll())) throw new Error('não foi possível salvar as abas abertas');
      const current = await api.read(action.path);
      if (base !== undefined && current !== base) {
        const ok = await confirmDialog(`"${action.path}" mudou depois da prévia. Aplicar a versão do Claude mesmo assim? As mudanças novas serão substituídas.`, { confirmLabel: 'Aplicar', danger: true });
        if (!ok) return false;
      }
      await api.write(action.path, action.content);
    }
    await this.store.refresh();
    await this.workspace.vaultChanged();
    return true;
  }
}

// Settings tab: which Claude Code runs, and the model.
export const claudeSection = {
  id: 'claude',
  title: 'Claude',
  async render(host) {
    const status = el('p', { class: 'setting-desc', text: 'Procurando o Claude Code…' });
    const command = el('input', { type: 'text', spellcheck: 'false', class: 'setting-wide', placeholder: 'automático', 'aria-label': 'Comando do Claude Code' });
    const model = el('select', { 'aria-label': 'Modelo' },
      [['', 'Padrão do Claude Code'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([v, label]) => el('option', { value: v, text: label })));
    model.value = prefs.get('claudeModel');
    model.addEventListener('change', () => prefs.set('claudeModel', model.value));
    const showStatus = async () => {
      try {
        const s = await api.claudeStatus();
        command.value = s.override;
        status.textContent = s.found ? `Encontrado${s.via === 'wsl' ? ' no WSL' : ''}: ${s.command}` : 'Claude Code não encontrado. Instale-o e rode "claude" num terminal para entrar com a sua conta.';
        status.classList.toggle('error', !s.found);
      } catch (err) {
        status.textContent = errorText(err);
        status.classList.add('error');
      }
    };
    const saveCommand = el('button', {
      text: 'Salvar e testar',
      onclick: async () => {
        try {
          await api.claudeSetCommand(command.value.trim());
          await showStatus();
        } catch (err) {
          status.textContent = errorText(err);
          status.classList.add('error');
        }
      },
    });
    host.append(
      el('p', { class: 'setting-desc', text: 'O assistente usa o Claude Code deste computador, com o login e a assinatura da sua conta do Claude. Ele só lê o vault; criações e alterações aparecem no painel para você aprovar.' }),
      status,
      settingRow('Comando do Claude Code', 'Vazio para encontrar sozinho. "wsl" usa o Claude Code de dentro do WSL; ou informe o caminho completo do executável.', el('span', { class: 'row' }, command, saveCommand)),
      settingRow('Modelo', null, model));
    await showStatus();
  },
};
