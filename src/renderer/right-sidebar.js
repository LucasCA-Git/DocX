import { el, icon, iconButton, displayName, dirName } from './dom';
import { backlinksFor, unlinkedMentions } from '../shared/backlinks-search';
import { GraphView } from './views/graph-view';

const STORAGE_KEY = 'docs.rightSidebar';
const UPDATE_DELAY_MS = 200;

// Right sidebar: panes about the last active note (backlinks, outgoing links,
// outline, local graph) and the vault's tags. Extra panes (bookmarks…) come in through addPane.
export class RightSidebar {
  constructor({ workspace, store, rootEl }) {
    this.workspace = workspace;
    this.store = store;
    this.state = { open: false, tab: 'backlinks', mentionsOpen: false };
    try {
      Object.assign(this.state, JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Defaults.
    }
    this.panes = new Map();
    this.tabsEl = el('div', { class: 'nav-buttons right-sidebar-tabs' });
    this.bodyEl = el('div', { class: 'right-sidebar-body' });
    rootEl.append(el('div', { class: 'sidebar-header titlebar-drag' }), this.tabsEl, this.bodyEl);

    this.addPane({ id: 'backlinks', icon: 'link', title: 'Backlinks', render: (host) => this.renderBacklinks(host) });
    this.addPane({ id: 'outgoing', icon: 'arrow-up-right', title: 'Links de saída', render: (host) => this.renderOutgoing(host) });
    this.addPane({ id: 'outline', icon: 'list', title: 'Estrutura (títulos)', render: (host) => this.renderOutline(host) });
    this.addPane({ id: 'tags', icon: 'tag', title: 'Tags', render: (host) => this.renderTags(host) });
    this.addPane({ id: 'graph', icon: 'graph', title: 'Grafo local', render: null });

    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.render(), UPDATE_DELAY_MS);
    };
    workspace.addEventListener('change', schedule);
    store.addEventListener('change', schedule);
    store.addEventListener('links', schedule);
    this.apply();
  }

  // pane: { id, icon, title, render(host) } — render is called whenever the note or vault changed.
  // A pane that keeps its own content gives `el` instead (mounted once, render: null); `wide`
  // widens the sidebar while it is shown, `onShow` runs each time it comes on screen.
  addPane(pane) {
    const host = el('div', { class: `side-pane side-pane-${pane.id}` });
    if (pane.el) host.append(pane.el);
    const button = iconButton(pane.icon, pane.title, () => this.showTab(pane.id));
    this.panes.set(pane.id, { ...pane, host, button });
    this.tabsEl.append(button);
    this.bodyEl.append(host);
    if (this.timer !== undefined) this.apply();
  }

  toggle() {
    this.state.open = !this.state.open;
    this.apply();
  }

  showTab(tab) {
    this.state.tab = tab;
    this.state.open = true;
    this.apply();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Not remembered.
    }
  }

  apply() {
    if (!this.panes.has(this.state.tab)) this.state.tab = 'backlinks';
    this.save();
    document.body.classList.toggle('is-right-sidebar-open', this.state.open);
    const shown = this.state.open ? this.panes.get(this.state.tab) : null;
    document.body.classList.toggle('is-right-sidebar-wide', Boolean(shown?.wide));
    for (const [id, pane] of this.panes) {
      pane.button.classList.toggle('is-active', id === this.state.tab);
      pane.host.hidden = id !== this.state.tab;
    }
    // The local graph (and its worker) exists only while it is on screen.
    const graph = this.state.open && this.state.tab === 'graph';
    if (graph && !this.graph) {
      this.graph = new GraphView({ workspace: this.workspace, store: this.store, local: true });
      this.panes.get('graph').host.append(this.graph.el);
    } else if (!graph && this.graph) {
      this.graph.destroy();
      this.graph.el.remove();
      this.graph = null;
    }
    this.graph?.onShow();
    shown?.onShow?.();
    this.render();
  }

  render() {
    if (!this.state.open) return;
    const pane = this.panes.get(this.state.tab);
    if (!pane?.render) return;
    // Keep the scroll position across re-renders of the same pane.
    const { scrollTop } = pane.host;
    pane.host.replaceChildren();
    pane.render(pane.host);
    pane.host.scrollTop = scrollTop;
  }

  note() {
    return this.workspace.followedNotePath;
  }

  openFile(path, event, reveal = null) {
    this.workspace.openFile(path, { newTab: event.ctrlKey || event.metaKey, reveal });
  }

  resultGroup(source, lines, lineContent) {
    return el('div', { class: 'result-group' },
      el('div', { class: 'result-title', title: source, onclick: (event) => this.openFile(source, event) },
        el('span', { text: displayName(source) }), dirName(source) ? el('span', { class: 'result-folder', text: dirName(source) }) : null),
      ...lines.map((line) => el('div', {
        class: 'result-line',
        onclick: (event) => this.openFile(source, event, { line: line.line, from: line.from ?? 0, to: line.to ?? line.from ?? 0 }),
      }, ...lineContent(line))));
  }

  renderBacklinks(host) {
    const rel = this.note();
    if (!rel) {
      host.append(el('p', { class: 'pane-empty', text: 'Abra uma nota para ver quem aponta para ela.' }));
      return;
    }
    const sources = backlinksFor(this.store.index, rel, (source) => this.store.texts.get(source));
    host.append(el('div', { class: 'pane-header' },
      el('span', { text: 'Links para ' }), el('strong', { text: displayName(rel) }),
      el('span', { class: 'pane-count', text: String(sources.length) })));
    if (!sources.length) host.append(el('p', { class: 'pane-empty', text: 'Nenhuma nota aponta para esta.' }));
    for (const { source, lines } of sources) host.append(this.resultGroup(source, lines, (line) => [line.text.trim()]));

    // Unlinked mentions: the note's name written as plain text elsewhere; "Ligar" turns it into a link.
    const toggle = el('div', { class: 'pane-header pane-collapsible', onclick: () => { this.state.mentionsOpen = !this.state.mentionsOpen; this.save(); this.render(); } },
      icon(this.state.mentionsOpen ? 'chevron-down' : 'chevron-right', 14), el('span', { text: 'Menções não ligadas' }));
    host.append(toggle);
    if (!this.state.mentionsOpen) return;
    this.mentionsCache ??= new Map();
    const mentions = unlinkedMentions(this.store.index, rel, this.store.texts, this.mentionsCache);
    toggle.append(el('span', { class: 'pane-count', text: String(mentions.length) }));
    if (!mentions.length) host.append(el('p', { class: 'pane-empty', text: 'Nenhuma menção sem link.' }));
    for (const { source, lines } of mentions) {
      host.append(this.resultGroup(source, lines, (line) => [
        line.text.slice(Math.max(0, line.from - 40), line.from),
        el('mark', { text: line.text.slice(line.from, line.to) }),
        line.text.slice(line.to, line.to + 60),
        el('button', {
          class: 'mention-link',
          text: 'Ligar',
          title: 'Transformar em link',
          onclick: (event) => {
            event.stopPropagation();
            this.workspace.linkMention(source, line, rel);
          },
        }),
      ]));
    }
  }

  renderOutgoing(host) {
    const rel = this.note();
    if (!rel) {
      host.append(el('p', { class: 'pane-empty', text: 'Abra uma nota para ver os links dela.' }));
      return;
    }
    const links = this.store.index.outgoing(rel);
    const resolved = [...new Set(links.filter((l) => l.resolved && l.resolved !== rel).map((l) => l.resolved))].sort();
    const unresolved = [...new Set(links.filter((l) => !l.resolved && l.target).map((l) => l.target))].sort();
    host.append(el('div', { class: 'pane-header' },
      el('span', { text: 'Links de ' }), el('strong', { text: displayName(rel) }),
      el('span', { class: 'pane-count', text: String(resolved.length) })));
    if (!resolved.length) host.append(el('p', { class: 'pane-empty', text: 'Esta nota não aponta para outras.' }));
    for (const target of resolved) {
      host.append(el('div', { class: 'result-title', title: target, onclick: (event) => this.openFile(target, event) },
        icon('file-text', 14), el('span', { text: displayName(target) }),
        dirName(target) ? el('span', { class: 'result-folder', text: dirName(target) }) : null));
    }
    if (unresolved.length) {
      host.append(el('div', { class: 'pane-header' }, el('span', { text: 'Sem destino' }), el('span', { class: 'pane-count', text: String(unresolved.length) })));
      for (const target of unresolved) {
        host.append(el('div', { class: 'result-title is-unresolved', title: 'Clique para criar', onclick: (event) => this.workspace.openLink(target, rel, { newTab: event.ctrlKey }) },
          icon('file-plus', 14), el('span', { text: target })));
      }
    }
  }

  renderOutline(host) {
    const rel = this.note();
    const headings = rel ? this.store.index.metadata(rel)?.headings ?? [] : [];
    if (!rel || !headings.length) {
      host.append(el('p', { class: 'pane-empty', text: rel ? 'Esta nota não tem títulos.' : 'Abra uma nota para ver a estrutura.' }));
      return;
    }
    const min = Math.min(...headings.map((h) => h.level));
    host.append(el('div', { class: 'pane-header' }, el('strong', { text: displayName(rel) })));
    for (const h of headings) {
      host.append(el('div', {
        class: 'outline-item',
        style: `padding-left: ${8 + (h.level - min) * 16}px`,
        title: h.text,
        onclick: (event) => this.openFile(rel, event, { line: h.line }),
      }, h.text));
    }
  }

  renderTags(host) {
    const counts = this.store.index.tagCounts();
    if (!counts.length) {
      host.append(el('p', { class: 'pane-empty', text: 'Nenhuma tag no vault. Escreva #tag numa nota ou tags: no front matter.' }));
      return;
    }
    // Nested tags (a/b) as a tree; a parent's count includes its children.
    const root = { children: new Map(), count: 0 };
    for (const { tag, count } of counts) {
      let node = root;
      tag.split('/').forEach((part, i, parts) => {
        const key = part.toLowerCase();
        if (!node.children.has(key)) node.children.set(key, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), count: 0 });
        node = node.children.get(key);
        node.count += count;
      });
    }
    host.append(el('div', { class: 'pane-header' }, el('span', { text: 'Tags' }), el('span', { class: 'pane-count', text: String(counts.length) })));
    const renderNode = (node, depth) => {
      const items = [...node.children.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      for (const child of items) {
        host.append(el('div', {
          class: 'tag-item',
          style: `padding-left: ${8 + depth * 16}px`,
          onclick: () => this.workspace.searchFor(`tag:#${child.path}`),
        }, el('span', { class: 'tag', text: `#${child.name}` }), el('span', { class: 'pane-count', text: String(child.count) })));
        renderNode(child, depth + 1);
      }
    };
    renderNode(root, 0);
  }
}
