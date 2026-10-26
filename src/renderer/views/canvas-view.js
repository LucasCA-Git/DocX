import {
  el, icon, iconButton, displayName, IMAGE_FILE, errorText,
} from '../dom';
import {
  parseCanvas, serializeCanvas, sidePoint, closestSide, nodesInRect, nodesInGroup, bounds, newId, SIDES,
} from '../../shared/canvas';
import { renderMarkdown } from '../markdown';
import { enhanceRendered } from '../render-extras';
import { renderNoteContent } from '../embeds';
import { assetUrl } from '../../shared/asset-url';
import { notice, promptDialog, renderDocStats } from '../status';
import { openSuggest, highlighted } from '../suggest-modal';
import { fuzzySort } from '../../shared/fuzzy';

const api = window.docs;
const SAVE_DELAY_MS = 600;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const MAX_UNDO = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';
// JSON Canvas preset colors "1"…"6".
const PRESETS = { 1: '#e93147', 2: '#ec7500', 3: '#e0ac00', 4: '#08b94e', 5: '#00bfbc', 6: '#7852ee' };
const colorOf = (c) => (typeof c !== 'string' ? null : Object.hasOwn(PRESETS, c) ? PRESETS[c] : /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

// A .canvas file: cards (text, note, link, group) on an infinite board joined by arrows, like
// Obsidian Canvas. Drag the background to pan, Ctrl+scroll to zoom, double-click to add a card,
// drag a card's side dot onto another card to connect them.
export class CanvasView {
  constructor({ workspace, store, path }) {
    this.workspace = workspace;
    this.store = store;
    this.path = path;
    this.canvas = { nodes: [], edges: [] };
    this.cam = { x: 0, y: 0, k: 1 };
    this.selected = new Set();
    this.selectedEdge = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.saving = Promise.resolve(true);
    this.nodeEls = new Map();
    this.editing = null;

    this.zoomLabel = el('span', { class: 'canvas-zoom-label' });
    this.toolbar = el('div', { class: 'canvas-toolbar' },
      iconButton('sticky-note', 'Novo cartão de texto (duplo clique no fundo)', () => this.addText(this.viewCenter())),
      iconButton('file-text', 'Adicionar nota ou arquivo', () => this.pickFile()),
      iconButton('link-2', 'Adicionar link da web', () => this.addLink()),
      iconButton('group', 'Agrupar selecionados', () => this.addGroup()),
      el('span', { class: 'canvas-toolbar-sep' }),
      ...Object.keys(PRESETS).map((c) => el('button', {
        class: 'canvas-color', title: 'Cor', style: `background:${PRESETS[c]}`, onclick: () => this.setColor(c),
      })),
      el('button', { class: 'canvas-color is-none', title: 'Sem cor', onclick: () => this.setColor(null) }),
      el('span', { class: 'canvas-toolbar-sep' }),
      iconButton('undo', 'Desfazer (Ctrl+Z)', () => this.undo()),
      iconButton('redo', 'Refazer (Ctrl+Shift+Z)', () => this.redo()),
      iconButton('maximize', 'Ajustar à tela', () => this.fit()),
      this.zoomLabel);

    this.edgesSvg = svg('svg', { class: 'canvas-edges' });
    const defs = svg('defs');
    const marker = svg('marker', { id: 'canvas-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }));
    defs.append(marker);
    this.edgesSvg.append(defs);
    this.nodesLayer = el('div', { class: 'canvas-nodes' });
    this.world = el('div', { class: 'canvas-world' }, this.edgesSvg, this.nodesLayer);
    this.selectionBox = el('div', { class: 'canvas-selection-box', hidden: true });
    this.board = el('div', { class: 'canvas-board', tabindex: '0' }, this.world, this.selectionBox, this.toolbar);
    this.titleEl = el('span', { class: 'view-header-title-text' });
    this.el = el('div', { class: 'view canvas-view' },
      el('div', { class: 'view-header' }, el('div', { class: 'view-header-title' }, this.titleEl)),
      el('div', { class: 'view-content canvas-content' }, this.board));
    this.el.dataset.sourcePath = path;

    this.board.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.board.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.board.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.board.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.board.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.board.addEventListener('keydown', (e) => this.onKey(e));
    this.board.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-docs-path')) e.preventDefault();
    });
    this.board.addEventListener('drop', (e) => this.onDrop(e));
    this.load();
  }

  get type() { return 'canvas'; }

  get title() { return this.path ? displayName(this.path).replace(/\.canvas$/i, '') : 'Canvas'; }

  get iconName() { return 'canvas'; }

  // ---------- file ----------

  async load() {
    try {
      const text = await api.read(this.path);
      this.canvas = parseCanvas(text);
      this.lastSaved = text;
    } catch (err) {
      notice(err, { error: true });
    }
    this.titleEl.textContent = this.title;
    this.render();
    this.fit();
  }

  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  save() {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return this.saving;
    const text = serializeCanvas(this.canvas);
    const path = this.path;
    this.dirty = false;
    this.saving = this.saving.then(async () => {
      try {
        await api.write(path, text);
        this.lastSaved = text;
        return true;
      } catch (err) {
        this.dirty = true;
        notice(`Erro ao salvar o canvas: ${errorText(err)}`, { error: true });
        return false;
      }
    });
    return this.saving;
  }

  flushed() {
    clearTimeout(this.saveTimer);
    return this.saving;
  }

  // Before every change: the previous state goes to the undo stack.
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.canvas));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  changed() {
    this.render();
    this.scheduleSave();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.canvas));
    this.canvas = JSON.parse(this.undoStack.pop());
    this.selected.clear();
    this.changed();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.canvas));
    this.canvas = JSON.parse(this.redoStack.pop());
    this.changed();
  }

  node(id) {
    return this.canvas.nodes.find((n) => n.id === id);
  }

  // ---------- camera ----------

  toWorld(clientX, clientY) {
    const r = this.board.getBoundingClientRect();
    return { x: (clientX - r.left - this.cam.x) / this.cam.k, y: (clientY - r.top - this.cam.y) / this.cam.k };
  }

  viewCenter() {
    const r = this.board.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  applyCamera() {
    this.world.style.transform = `translate(${this.cam.x}px, ${this.cam.y}px) scale(${this.cam.k})`;
    this.board.style.backgroundSize = `${24 * this.cam.k}px ${24 * this.cam.k}px`;
    this.board.style.backgroundPosition = `${this.cam.x}px ${this.cam.y}px`;
    this.zoomLabel.textContent = `${Math.round(this.cam.k * 100)}%`;
  }

  fit() {
    const r = this.board.getBoundingClientRect();
    if (!r.width) {
      requestAnimationFrame(() => this.board.isConnected && this.fit());
      return;
    }
    const b = bounds(this.canvas.nodes);
    if (!b.width) {
      this.cam = { x: r.width / 2, y: r.height / 2, k: 1 };
    } else {
      const k = Math.min(1, Math.max(MIN_ZOOM, Math.min((r.width - 80) / b.width, (r.height - 120) / b.height)));
      this.cam = { k, x: r.width / 2 - (b.x + b.width / 2) * k, y: r.height / 2 - (b.y + b.height / 2) * k };
    }
    this.applyCamera();
  }

  onWheel(event) {
    // Text inside a card scrolls normally.
    const content = event.target.closest('.canvas-node-content');
    if (content && !event.ctrlKey && content.scrollHeight > content.clientHeight) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const r = this.board.getBoundingClientRect();
      const px = event.clientX - r.left;
      const py = event.clientY - r.top;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.k * Math.exp(-event.deltaY * 0.002)));
      this.cam.x = px - ((px - this.cam.x) * k) / this.cam.k;
      this.cam.y = py - ((py - this.cam.y) * k) / this.cam.k;
      this.cam.k = k;
    } else {
      this.cam.x -= event.shiftKey ? event.deltaY : event.deltaX;
      this.cam.y -= event.shiftKey ? 0 : event.deltaY;
    }
    this.applyCamera();
  }

  // ---------- rendering ----------

  render() {
    const seen = new Set();
    // Groups first: drawn behind cards.
    const ordered = [...this.canvas.nodes.filter((n) => n.type === 'group'), ...this.canvas.nodes.filter((n) => n.type !== 'group')];
    ordered.forEach((n) => {
      seen.add(n.id);
      if (n.id === this.editing) return;
      let item = this.nodeEls.get(n.id);
      const key = JSON.stringify([n.type, n.text, n.file, n.subpath, n.url, n.label, this.store.version]);
      if (!item || item.key !== key) {
        item?.el.remove();
        item = { el: this.buildNode(n), key };
        this.nodeEls.set(n.id, item);
      }
      this.nodesLayer.append(item.el);
      this.place(item.el, n);
    });
    for (const [id, item] of this.nodeEls) {
      if (!seen.has(id)) {
        item.el.remove();
        this.nodeEls.delete(id);
      }
    }
    this.renderEdges();
    this.applyCamera();
  }

  place(nodeEl, n) {
    nodeEl.style.left = `${n.x}px`;
    nodeEl.style.top = `${n.y}px`;
    nodeEl.style.width = `${n.width}px`;
    nodeEl.style.height = `${n.height}px`;
    const color = colorOf(n.color);
    if (color) nodeEl.style.setProperty('--canvas-color', color);
    else nodeEl.style.removeProperty('--canvas-color');
    nodeEl.classList.toggle('is-selected', this.selected.has(n.id));
    nodeEl.classList.toggle('has-color', Boolean(color));
  }

  buildNode(n) {
    const nodeEl = el('div', { class: `canvas-node canvas-node-${n.type}`, dataset: { id: n.id } });
    if (n.type === 'group') {
      nodeEl.append(el('div', { class: 'canvas-group-label', text: n.label || 'Grupo' }));
    } else {
      const content = el('div', { class: 'canvas-node-content' });
      if (n.type === 'text') {
        content.classList.add('markdown-reading');
        content.innerHTML = renderMarkdown(n.text ?? '', (t) => this.store.resolve(t, this.path));
        enhanceRendered(content);
        content.addEventListener('click', (e) => this.onContentLink(e, this.path));
      } else if (n.type === 'file') {
        const resolved = this.store.has(n.file) ? n.file : null;
        nodeEl.append(el('div', { class: 'canvas-file-title', title: n.file, onclick: () => this.workspace.openLink(n.file + (n.subpath ?? ''), null, {}) },
          icon(IMAGE_FILE.test(n.file) ? 'image' : 'file-text', 13), el('span', { text: displayName(n.file) })));
        if (!resolved) content.append(el('p', { class: 'embed-missing', text: `"${n.file}" não existe.` }));
        else if (IMAGE_FILE.test(resolved)) content.append(el('img', { src: assetUrl(resolved), alt: displayName(resolved), draggable: 'false' }));
        else if (/\.(md|markdown|txt)$/i.test(resolved)) content.append(renderNoteContent(resolved, n.subpath?.replace(/^#/, '') || null, { store: this.store, workspace: this.workspace, depth: 1, seen: new Set() }));
        else content.append(el('p', { text: displayName(resolved) }));
      } else if (n.type === 'link') {
        content.append(el('div', { class: 'canvas-link' },
          icon('link-2', 18),
          /^https?:\/\//i.test(n.url)
            ? el('a', { href: n.url, text: n.url, onclick: (e) => { e.preventDefault(); window.open(n.url); } })
            : el('span', { text: n.url })));
      }
      nodeEl.append(content);
    }
    // Connection dots on the four sides and a resize corner.
    for (const side of SIDES) nodeEl.append(el('div', { class: `canvas-handle canvas-handle-${side}`, dataset: { side } }));
    nodeEl.append(el('div', { class: 'canvas-resize' }));
    return nodeEl;
  }

  onContentLink(event, source) {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    if (link.dataset.tag !== undefined) this.workspace.searchFor(`tag:#${link.dataset.tag}`);
    else if (link.dataset.href !== undefined) this.workspace.openLink(link.dataset.href, source, { newTab: event.ctrlKey || event.metaKey });
    else if (/^https?:\/\//.test(link.href)) window.open(link.href);
  }

  edgeGeometry(edge) {
    const from = this.node(edge.fromNode);
    const to = this.node(edge.toNode);
    if (!from || !to) return null;
    const fromSide = edge.fromSide ?? closestSide(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
    const toSide = edge.toSide ?? closestSide(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
    return { a: sidePoint(from, fromSide), b: sidePoint(to, toSide), fromSide, toSide };
  }

  edgePath({ a, b, fromSide, toSide }) {
    const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3);
    const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
    const c1 = { x: a.x + dir[fromSide][0] * dist, y: a.y + dir[fromSide][1] * dist };
    const c2 = { x: b.x + dir[toSide][0] * dist, y: b.y + dir[toSide][1] * dist };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  }

  renderEdges() {
    const defs = this.edgesSvg.querySelector('defs');
    this.edgesSvg.replaceChildren(defs);
    for (const edge of this.canvas.edges) {
      const g = this.edgeGeometry(edge);
      if (!g) continue;
      const d = this.edgePath(g);
      const color = colorOf(edge.color) ?? 'var(--canvas-edge)';
      const group = svg('g', { class: `canvas-edge${edge.id === this.selectedEdge ? ' is-selected' : ''}`, 'data-edge': edge.id });
      const line = svg('path', { d, class: 'canvas-edge-line', stroke: color });
      if ((edge.toEnd ?? 'arrow') === 'arrow') line.setAttribute('marker-end', 'url(#canvas-arrow)');
      if (edge.fromEnd === 'arrow') line.setAttribute('marker-start', 'url(#canvas-arrow)');
      group.append(svg('path', { d, class: 'canvas-edge-hit' }), line);
      if (edge.label) {
        const label = svg('text', { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2, class: 'canvas-edge-label', 'text-anchor': 'middle' });
        label.textContent = edge.label;
        group.append(label);
      }
      this.edgesSvg.append(group);
    }
  }

  // ---------- adding things ----------

  addNode(node) {
    this.checkpoint();
    const created = { id: newId(), ...node };
    this.canvas.nodes.push(created);
    this.selected = new Set([created.id]);
    this.changed();
    return created;
  }

  addText(at) {
    const node = this.addNode({ type: 'text', text: '', x: Math.round(at.x - 130), y: Math.round(at.y - 40), width: 260, height: 80 });
    this.editText(node);
  }

  pickFile(at = this.viewCenter()) {
    const files = this.store.files.filter((f) => !/\.canvas$/i.test(f));
    openSuggest({
      placeholder: 'Nota ou arquivo para o canvas…',
      instructions: [['↑↓', 'navegar'], ['Enter', 'adicionar'], ['Esc', 'cancelar']],
      getItems: (q) => (q.trim() ? fuzzySort(q, files, (f) => f).map((r) => ({ path: r.item, ranges: r.ranges })) : files.map((path) => ({ path, ranges: [] }))),
      render: ({ path, ranges }) => [icon(IMAGE_FILE.test(path) ? 'image' : 'file-text', 16), el('span', { class: 'suggestion-main' }, ...highlighted(path, ranges))],
      choose: (item) => item && this.addFile(item.path, at),
    });
  }

  addFile(path, at) {
    const image = IMAGE_FILE.test(path);
    this.addNode({ type: 'file', file: path, x: Math.round(at.x - 200), y: Math.round(at.y - 150), width: 400, height: image ? 300 : 400 });
  }

  async addLink() {
    const url = await promptDialog('Endereço do link:', { placeholder: 'https://…' });
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      notice('Use um endereço http(s)://', { error: true });
      return;
    }
    const at = this.viewCenter();
    this.addNode({ type: 'link', url, x: Math.round(at.x - 200), y: Math.round(at.y - 60), width: 400, height: 120 });
  }

  // A group around the selected cards (or an empty one in the middle of the view).
  async addGroup() {
    const label = await promptDialog('Nome do grupo:', { value: 'Grupo' });
    if (label === null) return;
    const chosen = this.canvas.nodes.filter((n) => this.selected.has(n.id));
    const pad = 40;
    let rect;
    if (chosen.length) {
      const b = bounds(chosen);
      rect = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
    } else {
      const c = this.viewCenter();
      rect = { x: Math.round(c.x - 300), y: Math.round(c.y - 200), width: 600, height: 400 };
    }
    this.addNode({ type: 'group', label, ...rect });
  }

  setColor(color) {
    if (!this.selected.size && !this.selectedEdge) return;
    this.checkpoint();
    for (const n of this.canvas.nodes) {
      if (!this.selected.has(n.id)) continue;
      if (color) n.color = color;
      else delete n.color;
    }
    const edge = this.canvas.edges.find((e) => e.id === this.selectedEdge);
    if (edge) {
      if (color) edge.color = color;
      else delete edge.color;
    }
    this.changed();
  }

  // Text cards are edited in place; the Markdown shows again on blur.
  editText(node) {
    const item = this.nodeEls.get(node.id);
    if (!item) return;
    const content = item.el.querySelector('.canvas-node-content');
    const area = el('textarea', { class: 'canvas-text-editor', spellcheck: 'true' });
    area.value = node.text ?? '';
    content.replaceWith(area);
    this.editing = node.id;
    area.focus();
    const finish = () => {
      area.removeEventListener('blur', finish);
      this.editing = null;
      if (area.value !== (node.text ?? '')) {
        this.checkpoint();
        node.text = area.value;
        this.scheduleSave();
      }
      item.key = null;
      this.render();
      this.board.focus({ preventScroll: true });
    };
    area.addEventListener('blur', finish);
    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') area.blur();
    });
  }

  async editEdgeLabel(edge) {
    const label = await promptDialog('Rótulo da conexão:', { value: edge.label ?? '' });
    if (label === null && !edge.label) return;
    this.checkpoint();
    if (label) edge.label = label;
    else delete edge.label;
    this.changed();
  }

  // ---------- pointer ----------

  onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest('.canvas-toolbar, textarea, a, .canvas-file-title')) return;
    this.board.focus({ preventScroll: true });
    const p = this.toWorld(event.clientX, event.clientY);
    const nodeEl = event.target.closest('.canvas-node');
    const node = nodeEl ? this.node(nodeEl.dataset.id) : null;
    const edgeEl = event.target.closest('.canvas-edge');
    this.board.setPointerCapture(event.pointerId);
    const start = { clientX: event.clientX, clientY: event.clientY, p };

    if (event.button === 1 || (!node && !edgeEl && !event.shiftKey)) {
      this.drag = { kind: 'pan', start, cam: { ...this.cam }, moved: false };
      return;
    }
    if (edgeEl && !node) {
      this.selectedEdge = edgeEl.dataset.edge;
      this.selected.clear();
      this.render();
      return;
    }
    if (!node) {
      this.drag = { kind: 'select', start };
      return;
    }
    if (event.target.classList.contains('canvas-handle')) {
      this.drag = { kind: 'connect', from: node, fromSide: event.target.dataset.side, start, line: svg('path', { class: 'canvas-edge-line is-temp', 'marker-end': 'url(#canvas-arrow)' }) };
      this.edgesSvg.append(this.drag.line);
      return;
    }
    if (event.target.classList.contains('canvas-resize')) {
      this.checkpoint();
      this.drag = { kind: 'resize', node, start, size: { width: node.width, height: node.height } };
      return;
    }
    this.selectedEdge = null;
    if (event.shiftKey) {
      if (this.selected.has(node.id)) this.selected.delete(node.id);
      else this.selected.add(node.id);
    } else if (!this.selected.has(node.id)) {
      this.selected = new Set([node.id]);
    }
    // Moving a group moves the cards inside it.
    const moving = new Set(this.selected);
    for (const n of this.canvas.nodes) {
      if (moving.has(n.id) && n.type === 'group') for (const inner of nodesInGroup(this.canvas.nodes, n)) moving.add(inner.id);
    }
    this.drag = {
      kind: 'move', start, moved: false, nodes: [...moving].map((id) => this.node(id)).filter(Boolean).map((n) => ({ n, x: n.x, y: n.y })),
    };
    this.render();
  }

  onPointerMove(event) {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.clientX - drag.start.clientX;
    const dy = event.clientY - drag.start.clientY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.kind === 'pan') {
      this.cam.x = drag.cam.x + dx;
      this.cam.y = drag.cam.y + dy;
      this.applyCamera();
    } else if (drag.kind === 'move' && drag.moved) {
      if (!drag.checkpointed) {
        this.checkpoint();
        drag.checkpointed = true;
      }
      for (const { n, x, y } of drag.nodes) {
        n.x = Math.round(x + dx / this.cam.k);
        n.y = Math.round(y + dy / this.cam.k);
        const item = this.nodeEls.get(n.id);
        if (item) this.place(item.el, n);
      }
      this.renderEdges();
    } else if (drag.kind === 'resize') {
      drag.node.width = Math.max(80, Math.round(drag.size.width + dx / this.cam.k));
      drag.node.height = Math.max(40, Math.round(drag.size.height + dy / this.cam.k));
      const item = this.nodeEls.get(drag.node.id);
      if (item) this.place(item.el, drag.node);
      this.renderEdges();
    } else if (drag.kind === 'connect') {
      const p = this.toWorld(event.clientX, event.clientY);
      const a = sidePoint(drag.from, drag.fromSide);
      drag.line.setAttribute('d', `M ${a.x} ${a.y} L ${p.x} ${p.y}`);
    } else if (drag.kind === 'select') {
      const r = this.board.getBoundingClientRect();
      const x = Math.min(event.clientX, drag.start.clientX) - r.left;
      const y = Math.min(event.clientY, drag.start.clientY) - r.top;
      Object.assign(this.selectionBox.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
      this.selectionBox.hidden = false;
    }
  }

  onPointerUp(event) {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.kind === 'pan' && !drag.moved) {
      this.selected.clear();
      this.selectedEdge = null;
      this.render();
    } else if (drag.kind === 'move' || drag.kind === 'resize') {
      if (drag.moved || drag.kind === 'resize') this.changed();
    } else if (drag.kind === 'connect') {
      drag.line.remove();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.canvas-node');
      const to = target ? this.node(target.dataset.id) : null;
      const p = this.toWorld(event.clientX, event.clientY);
      if (to && to.id !== drag.from.id) {
        this.checkpoint();
        this.canvas.edges.push({ id: newId(), fromNode: drag.from.id, fromSide: drag.fromSide, toNode: to.id, toSide: closestSide(to, p), toEnd: 'arrow' });
        this.changed();
      } else if (!to && drag.moved) {
        // Dropped on empty space: a new card there, connected.
        this.checkpoint();
        const node = { id: newId(), type: 'text', text: '', x: Math.round(p.x - 130), y: Math.round(p.y - 40), width: 260, height: 80 };
        this.canvas.nodes.push(node);
        this.canvas.edges.push({ id: newId(), fromNode: drag.from.id, fromSide: drag.fromSide, toNode: node.id, toSide: closestSide(node, sidePoint(drag.from, drag.fromSide)), toEnd: 'arrow' });
        this.selected = new Set([node.id]);
        this.changed();
        this.editText(node);
      }
    } else if (drag.kind === 'select') {
      this.selectionBox.hidden = true;
      const a = drag.start.p;
      const b = this.toWorld(event.clientX, event.clientY);
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
      for (const n of nodesInRect(this.canvas.nodes, rect)) this.selected.add(n.id);
      this.render();
    }
  }

  onDoubleClick(event) {
    if (event.target.closest('.canvas-toolbar, textarea')) return;
    const nodeEl = event.target.closest('.canvas-node');
    const edgeEl = event.target.closest('.canvas-edge');
    if (!nodeEl && edgeEl) {
      const edge = this.canvas.edges.find((e) => e.id === edgeEl.dataset.edge);
      if (edge) this.editEdgeLabel(edge);
      return;
    }
    if (!nodeEl) {
      this.addText(this.toWorld(event.clientX, event.clientY));
      return;
    }
    const node = this.node(nodeEl.dataset.id);
    if (node?.type === 'text') this.editText(node);
    else if (node?.type === 'file') this.workspace.openFile(node.file, { newTab: true });
    else if (node?.type === 'group') {
      promptDialog('Nome do grupo:', { value: node.label ?? '' }).then((label) => {
        if (label === null) return;
        this.checkpoint();
        node.label = label;
        this.changed();
      });
    }
  }

  onDrop(event) {
    const path = event.dataTransfer.getData('application/x-docs-path');
    if (!path || this.store.folders.includes(path)) return;
    event.preventDefault();
    this.addFile(path, this.toWorld(event.clientX, event.clientY));
  }

  onKey(event) {
    if (this.editing || event.target.closest('textarea, input')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
    } else if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selected = new Set(this.canvas.nodes.map((n) => n.id));
      this.render();
    } else if (event.key === 'Escape') {
      this.selected.clear();
      this.selectedEdge = null;
      this.render();
    } else if (event.key === 'Enter' && this.selected.size === 1) {
      const node = this.node([...this.selected][0]);
      if (node?.type === 'text') {
        event.preventDefault();
        this.editText(node);
      }
    }
  }

  deleteSelection() {
    if (!this.selected.size && !this.selectedEdge) return;
    this.checkpoint();
    this.canvas.nodes = this.canvas.nodes.filter((n) => !this.selected.has(n.id));
    const ids = new Set(this.canvas.nodes.map((n) => n.id));
    this.canvas.edges = this.canvas.edges.filter((e) => e.id !== this.selectedEdge && ids.has(e.fromNode) && ids.has(e.toNode));
    this.selected.clear();
    this.selectedEdge = null;
    this.changed();
  }

  // ---------- workspace contract ----------

  get isDirty() {
    return this.dirty;
  }

  async reloadIfClean() {
    if (this.dirty || this.editing) return;
    const text = await api.read(this.path).catch(() => null);
    if (text === null || text === this.lastSaved) return;
    this.canvas = parseCanvas(text);
    this.lastSaved = text;
    this.render();
  }

  pathRenamed(from, to) {
    const map = (p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    const next = map(this.path);
    // Cards pointing at the renamed file follow it.
    let changed = false;
    for (const n of this.canvas.nodes) {
      if (n.type === 'file' && map(n.file) !== n.file) {
        n.file = map(n.file);
        changed = true;
      }
    }
    if (next !== this.path) {
      this.path = next;
      this.el.dataset.sourcePath = next;
      this.titleEl.textContent = this.title;
    }
    if (changed) this.changed();
  }

  onShow() {
    renderDocStats(null);
    this.render();
  }

  onHide() {
    this.save();
  }

  destroy() {
    this.save();
  }

  serialize() {
    return { type: 'canvas', path: this.path };
  }
}
