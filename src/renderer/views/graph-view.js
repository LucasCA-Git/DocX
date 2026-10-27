import { el, icon, iconButton } from '../dom';
import { renderDocStats } from '../status';
import {
  graphData, nodeRadius, toWorld, zoomAt, hitTest,
} from '../../shared/graph-model';

const OPTIONS_KEY = 'docs.graph';
const UPDATE_DELAY_MS = 300;
const DRAG_THRESHOLD_PX = 3;
// Labels fade in between these zoom levels (always shown for the hovered node and neighbours).
const LABEL_FADE = [0.55, 1.1];

const COLORS = {
  note: '#a3a3a3',
  attachment: '#d9b23a',
  unresolved: '#5c5c5c',
  tag: '#4fb3a9',
  link: 'rgba(160, 160, 160, 0.28)',
  highlight: '#7f6df2',
  label: '#dadada',
};

const LINK_BATCH = 256;
const SPRITE_SIZE = 64;

// One antialiased circle per color, scaled to each node's size when drawn.
const SPRITES = new Map();
function sprite(color) {
  if (!SPRITES.has(color)) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const c = canvas.getContext('2d');
    c.fillStyle = color;
    c.beginPath();
    c.arc(SPRITE_SIZE / 2, SPRITE_SIZE / 2, SPRITE_SIZE / 2 - 1, 0, Math.PI * 2);
    c.fill();
    SPRITES.set(color, canvas);
  }
  return SPRITES.get(color);
}

export const DEFAULT_FORCES = { center: 0.04, repel: 90, link: 0.6, distance: 40 };
const GROUP_COLORS = ['#e9973f', '#4fb3a9', '#e05d6f', '#5b8def', '#b07de8', '#7cc56b'];

function loadOptions(key) {
  const defaults = {
    attachments: true, unresolved: false, orphans: true, tags: false, arrows: false, search: '',
    groups: [], depth: 1, nodeSize: 1, forces: { ...DEFAULT_FORCES }, open: { filters: true, groups: false, display: false, forces: false },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key)) ?? {};
    return {
      ...defaults,
      ...saved,
      groups: Array.isArray(saved.groups) ? saved.groups.filter((g) => typeof g?.query === 'string' && /^#[0-9a-f]{6}$/i.test(g.color)) : [],
      forces: { ...DEFAULT_FORCES, ...saved.forces },
      open: { ...defaults.open, ...saved.open },
    };
  } catch {
    return defaults;
  }
}

// Global Graph View: every note and attachment, linked by [[links]] and ![[embeds]]. The force
// simulation runs in a worker; this tab draws on a canvas and handles zoom, pan, drag and clicks.
// With `local`, it is the side panel's local graph: the last active note and its neighbours,
// without header or filter panel.
export class GraphView {
  constructor({ workspace, store, local = false }) {
    this.workspace = workspace;
    this.store = store;
    this.isLocal = local;
    this.optionsKey = local ? `${OPTIONS_KEY}.local` : OPTIONS_KEY;
    this.options = loadOptions(this.optionsKey);
    this.center = null;
    this.nodes = [];
    this.links = [];
    this.linkIndex = [];
    this.neighbours = [];
    this.positions = new Float32Array(0);
    this.gen = 0;
    this.signature = '';
    this.cam = { x: 0, y: 0, k: 1 };
    this.fitted = false;
    this.hover = -1;
    this.pointer = null;
    this.visible = false;
    this.frame = 0;

    this.canvas = el('canvas', { class: 'graph-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.controls = el('div', { class: 'graph-controls' });
    this.content = el('div', { class: 'view-content graph-content' }, this.canvas, this.controls);
    this.renderControls();
    this.el = el('div', { class: `view graph-view${local ? ' is-local' : ''}` },
      local ? null : el('div', { class: 'view-header' }, el('div', { class: 'view-header-title' }, el('span', { class: 'view-header-title-text', text: 'Visualização em gráfico' }))),
      this.content);

    this.worker = new Worker('graph-worker.js');
    this.worker.onmessage = ({ data }) => this.onWorker(data);
    this.worker.postMessage({ type: 'forces', forces: this.options.forces });

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', () => this.endDrag());
    this.canvas.addEventListener('lostpointercapture', () => this.endDrag());
    this.canvas.addEventListener('pointerleave', () => this.setHover(-1));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.content);

    this.onStoreChange = () => this.scheduleUpdate();
    store.addEventListener('change', this.onStoreChange);
    store.addEventListener('links', this.onStoreChange);
    if (local) workspace.addEventListener('change', this.onStoreChange);
    this.update();
  }

  get type() { return 'graph'; }

  get title() { return 'Visualização em gráfico'; }

  get iconName() { return 'graph'; }

  // ---------- controls ----------

  // Filters, color groups, display and forces settings. The local graph
  // starts collapsed to a gear button and has a depth slider instead of the search box.
  renderControls() {
    const save = () => this.saveOptions();
    const toggle = (key, label) => {
      const input = el('input', { type: 'checkbox', checked: this.options[key] });
      input.addEventListener('change', () => this.setOption(key, input.checked));
      return el('label', { class: 'graph-toggle' }, input, label);
    };
    const slider = (label, value, min, max, step, onInput) => {
      const input = el('input', { type: 'range', min, max, step, class: 'graph-slider' });
      input.value = value;
      input.addEventListener('input', () => onInput(Number(input.value)));
      return el('label', { class: 'graph-slider-row' }, el('span', { text: label }), input);
    };
    const section = (id, title, ...body) => {
      const open = this.options.open[id];
      return el('div', { class: 'graph-section' },
        el('div', {
          class: 'graph-section-title',
          onclick: () => {
            this.options.open[id] = !open;
            save();
            this.renderControls();
          },
        }, icon(open ? 'chevron-down' : 'chevron-right', 14), el('span', { text: title })),
        open ? el('div', { class: 'graph-section-body' }, ...body) : null);
    };
    const force = (key, label, min, max, step) => slider(label, this.options.forces[key], min, max, step, (v) => {
      this.options.forces[key] = v;
      save();
      this.worker.postMessage({ type: 'forces', forces: this.options.forces });
    });

    if (this.isLocal && !this.controlsOpen) {
      this.controls.className = 'graph-controls is-collapsed';
      this.controls.replaceChildren(iconButton('settings', 'Opções do grafo local', () => {
        this.controlsOpen = true;
        this.renderControls();
      }));
      return;
    }
    this.controls.className = 'graph-controls';
    const search = el('input', { class: 'graph-search', type: 'search', placeholder: 'Filtrar (ex.: tag:#projeto -path:arquivo)', value: this.options.search, spellcheck: 'false' });
    search.addEventListener('input', () => this.setOption('search', search.value));

    const groups = this.options.groups.map((group, i) => {
      const query = el('input', { class: 'graph-group-query', type: 'search', placeholder: 'tag:#x, path:pasta…', value: group.query, spellcheck: 'false' });
      query.addEventListener('input', () => {
        group.query = query.value;
        this.setOption('groups', this.options.groups);
      });
      const color = el('input', { type: 'color', class: 'graph-group-color', value: group.color });
      color.addEventListener('input', () => {
        group.color = color.value;
        save();
        this.requestDraw();
      });
      return el('div', { class: 'graph-controls-row' }, color, query, iconButton('x', 'Remover grupo', () => {
        this.options.groups.splice(i, 1);
        this.setOption('groups', this.options.groups);
        this.renderControls();
      }));
    });

    this.controls.replaceChildren(
      el('div', { class: 'graph-controls-row graph-controls-top' },
        this.isLocal ? el('span', { class: 'graph-controls-title', text: 'Grafo local' }) : search,
        iconButton('refresh', 'Centralizar', () => this.fit({ auto: false })),
        this.isLocal ? iconButton('x', 'Fechar opções', () => {
          this.controlsOpen = false;
          this.renderControls();
        }) : null),
      section('filters', 'Filtros',
        this.isLocal ? slider('Profundidade', this.options.depth, 1, 5, 1, (v) => this.setOption('depth', v)) : null,
        this.isLocal ? search : null,
        toggle('tags', 'Tags'),
        toggle('attachments', 'Anexos'),
        toggle('unresolved', 'Links sem nota'),
        toggle('orphans', 'Órfãs')),
      section('groups', 'Grupos',
        ...groups,
        el('button', {
          class: 'graph-add-group',
          text: 'Novo grupo',
          onclick: () => {
            this.options.groups.push({ query: '', color: GROUP_COLORS[this.options.groups.length % GROUP_COLORS.length] });
            save();
            this.renderControls();
          },
        })),
      section('display', 'Exibição',
        toggle('arrows', 'Setas'),
        slider('Tamanho dos nós', this.options.nodeSize, 0.5, 3, 0.1, (v) => {
          this.options.nodeSize = v;
          save();
          this.requestDraw();
        })),
      section('forces', 'Forças',
        force('center', 'Atração ao centro', 0, 0.3, 0.01),
        force('repel', 'Repulsão', 0, 400, 5),
        force('link', 'Força dos links', 0, 1, 0.05),
        force('distance', 'Distância dos links', 10, 300, 5)),
    );
  }

  saveOptions() {
    try {
      localStorage.setItem(this.optionsKey, JSON.stringify(this.options));
    } catch {
      // Options just won't persist.
    }
  }

  // A new filter re-frames the graph once it settles (unless the user zooms or drags first).
  setOption(key, value) {
    this.options[key] = value;
    this.fitted = false;
    this.saveOptions();
    this.scheduleUpdate();
  }

  // ---------- data ----------

  // A hidden graph only notes that it is out of date and catches up when shown.
  scheduleUpdate() {
    if (!this.visible) {
      this.stale = true;
      return;
    }
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.update(), UPDATE_DELAY_MS);
  }

  // Sends the graph to the worker only when nodes or links actually changed (typing that does
  // not touch links leaves the simulation alone).
  update() {
    const center = this.isLocal ? this.workspace.followedNotePath ?? '' : null;
    const { nodes, links } = graphData(this.store.index, { ...this.options, ...(this.isLocal ? { center } : { depth: 1 }) });
    const signature = `${center}@${nodes.map((n) => `${n.id}:${n.degree}:${n.group}`).join('|')}#${links.map((l) => `${l.source}>${l.target}`).join('|')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    // Another note in the local graph: frame it again.
    if (center !== this.center) this.fitted = false;
    this.center = center;

    const old = new Map(this.nodes.map((n, i) => [n.id, i]));
    const positions = new Float32Array(nodes.length * 2);
    nodes.forEach((n, i) => {
      const j = old.get(n.id);
      positions[i * 2] = j === undefined ? 0 : this.positions[j * 2];
      positions[i * 2 + 1] = j === undefined ? 0 : this.positions[j * 2 + 1];
    });
    const indexById = new Map(nodes.map((n, i) => [n.id, i]));
    this.nodes = nodes;
    this.links = links;
    this.positions = positions;
    this.linkIndex = links.map((l) => [indexById.get(l.source), indexById.get(l.target)]);
    this.neighbours = nodes.map(() => new Set());
    for (const [a, b] of this.linkIndex) {
      this.neighbours[a].add(b);
      this.neighbours[b].add(a);
    }
    this.hover = -1;
    this.gen += 1;
    // Counts on the element, for end-to-end tests and debugging.
    this.canvas.dataset.nodes = nodes.length;
    this.canvas.dataset.links = links.length;
    this.worker.postMessage({ type: 'graph', gen: this.gen, nodes: nodes.map((n) => ({ id: n.id, degree: n.degree })), links });
    this.requestDraw();
  }

  onWorker(data) {
    if (data.gen !== this.gen) return;
    // Until the user zooms, pans or drags, the camera follows the layout as it spreads out (and
    // starts zoomed out, where labels are hidden and drawing stays cheap).
    if (data.type === 'tick') {
      this.positions = data.positions;
      if (!this.fitted) this.fit({ auto: true });
      this.requestDraw();
    } else if (data.type === 'end' && !this.fitted) {
      this.fit({ auto: true });
    }
  }

  // ---------- camera ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.content;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (!this.width) {
      this.cam = { x: w / 2, y: h / 2, k: 1 };
    } else {
      this.cam.x += (w - this.width) / 2;
      this.cam.y += (h - this.height) / 2;
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.requestDraw();
  }

  // Zooms so every node fits in the view. The button (auto = false) also stops the camera from
  // following the layout.
  fit({ auto = false } = {}) {
    if (!this.nodes.length || !this.width) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      minX = Math.min(minX, this.positions[i * 2]);
      maxX = Math.max(maxX, this.positions[i * 2]);
      minY = Math.min(minY, this.positions[i * 2 + 1]);
      maxY = Math.max(maxY, this.positions[i * 2 + 1]);
    }
    const pad = 60;
    const k = Math.min(this.isLocal ? 1 : 2, (this.width - pad * 2) / Math.max(1, maxX - minX), (this.height - pad * 2) / Math.max(1, maxY - minY));
    if (![minX, minY, maxX, maxY, k].every(Number.isFinite) || k <= 0) return;
    if (!auto) this.fitted = true;
    this.cam = { k, x: this.width / 2 - ((minX + maxX) / 2) * k, y: this.height / 2 - ((minY + maxY) / 2) * k };
    this.requestDraw();
  }

  // ---------- input ----------

  local(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  nodeAt(event) {
    const p = this.local(event);
    const w = toWorld(this.cam, p.x, p.y);
    return hitTest(this.nodes, this.positions, w.x, w.y, this.cam.k);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    this.fitted = true;
    const p = this.local(event);
    // The node is kept by id: the graph can be rebuilt (a save, a sync) in the middle of a drag.
    const index = this.nodeAt(event);
    this.pointer = { id: index >= 0 ? this.nodes[index].id : null, start: p, last: p, moved: false };
    this.canvas.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    const p = this.local(event);
    const drag = this.pointer;
    if (!drag) {
      this.setHover(this.nodeAt(event));
      return;
    }
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    if (drag.id !== null) {
      const w = toWorld(this.cam, p.x, p.y);
      this.worker.postMessage({ type: 'drag', id: drag.id, x: w.x, y: w.y });
    } else {
      this.cam.x += p.x - drag.last.x;
      this.cam.y += p.y - drag.last.y;
      this.requestDraw();
    }
    drag.last = p;
  }

  // A click (no drag) on a node opens it; Ctrl+click opens a new tab. A missing note is created,
  // like clicking its link.
  onPointerUp(event) {
    const drag = this.endDrag();
    if (!drag || drag.id === null || drag.moved) return;
    const node = this.nodes.find((n) => n.id === drag.id);
    if (!node) return;
    const newTab = event.ctrlKey || event.metaKey;
    if (node.type === 'tag') this.workspace.searchFor(`tag:${node.id}`);
    else if (node.type === 'unresolved') this.workspace.openLink(node.id, null, { newTab });
    else this.workspace.openFile(node.id, { newTab });
  }

  // Ends a press (also on pointercancel): a dragged node is let go so the simulation can settle.
  endDrag() {
    const drag = this.pointer;
    this.pointer = null;
    if (drag?.moved && drag.id !== null) this.worker.postMessage({ type: 'release', id: drag.id });
    return drag;
  }

  onWheel(event) {
    event.preventDefault();
    this.fitted = true;
    const p = this.local(event);
    this.cam = zoomAt(this.cam, Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    this.requestDraw();
  }

  setHover(index) {
    if (index === this.hover) return;
    this.hover = index;
    this.canvas.style.cursor = index >= 0 ? 'pointer' : '';
    this.requestDraw();
  }

  // ---------- drawing ----------

  requestDraw() {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  // Theme colors from CSS (light/dark), read once per frame.
  themeColors() {
    const css = getComputedStyle(document.body);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    COLORS.note = v('--graph-node', COLORS.note);
    COLORS.link = v('--graph-link', COLORS.link);
    COLORS.label = v('--graph-label', COLORS.label);
    COLORS.highlight = v('--interactive-accent', COLORS.highlight);
  }

  draw() {
    const {
      ctx, cam, dpr, nodes, positions, hover,
    } = this;
    if (!this.width) return;
    this.themeColors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.x, dpr * cam.y);

    const near = hover >= 0 ? this.neighbours[hover] : null;
    const centerIndex = this.isLocal ? nodes.findIndex((n) => n.id === this.center) : -1;
    const lit = (i) => i === hover || Boolean(near?.has(i));
    const x = (i) => positions[i * 2];
    const y = (i) => positions[i * 2 + 1];
    // Visible world rectangle (with a margin for labels); nodes and labels outside are skipped.
    const margin = 80 / cam.k;
    const left = -cam.x / cam.k - margin;
    const top = -cam.y / cam.k - margin;
    const right = (this.width - cam.x) / cam.k + margin;
    const bottom = (this.height - cam.y) / cam.k + margin;
    const onScreen = (i) => x(i) >= left && x(i) <= right && y(i) >= top && y(i) <= bottom;

    // Links: dimmed while hovering, the hovered node's links in the accent color. One device pixel
    // wide: Skia draws hairlines about 10x faster than wider strokes (4000 links: 5 ms vs 58 ms).
    ctx.lineWidth = 1 / (cam.k * dpr);
    ctx.strokeStyle = COLORS.link;
    ctx.globalAlpha = hover >= 0 ? 0.35 : 1;
    let segments = 0;
    ctx.beginPath();
    for (const [a, b] of this.linkIndex) {
      if (a === hover || b === hover) continue;
      ctx.moveTo(x(a), y(a));
      ctx.lineTo(x(b), y(b));
      if (++segments % LINK_BATCH === 0) {
        ctx.stroke();
        ctx.beginPath();
      }
    }
    ctx.stroke();
    // Arrow heads at the target end, once zoomed in enough to see them.
    if (this.options.arrows && cam.k > 0.5) {
      ctx.fillStyle = COLORS.link;
      ctx.beginPath();
      const size = 6 / cam.k;
      for (const [a, b] of this.linkIndex) {
        if (!onScreen(b)) continue;
        const dx = x(b) - x(a);
        const dy = y(b) - y(a);
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const r = nodeRadius(nodes[b].degree) * this.options.nodeSize;
        const ux = dx / len;
        const uy = dy / len;
        const tipX = x(b) - ux * r;
        const tipY = y(b) - uy * r;
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
        ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
        ctx.closePath();
      }
      ctx.fill();
    }
    if (hover >= 0) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS.highlight;
      ctx.lineWidth = 1.5 / cam.k;
      ctx.beginPath();
      for (const [a, b] of this.linkIndex) {
        if (a !== hover && b !== hover) continue;
        ctx.moveTo(x(a), y(a));
        ctx.lineTo(x(b), y(b));
      }
      ctx.stroke();
    }

    // Nodes as pre-drawn circle sprites (much cheaper to rasterize than thousands of arcs); while
    // hovering, the rest is dimmed.
    const groupColors = this.options.groups.map((g) => g.color);
    for (let i = 0; i < nodes.length; i++) {
      if (!onScreen(i)) continue;
      const r = nodeRadius(nodes[i].degree) * this.options.nodeSize;
      ctx.globalAlpha = hover >= 0 && !lit(i) ? 0.25 : 1;
      const color = i === hover || i === centerIndex ? COLORS.highlight : groupColors[nodes[i].group] ?? COLORS[nodes[i].type];
      ctx.drawImage(sprite(color), x(i) - r, y(i) - r, r * 2, r * 2);
    }

    // Labels under the nodes, sized in world units so they grow with zoom.
    // The local graph is small: its labels always show.
    const fade = this.isLocal ? 1 : Math.min(1, Math.max(0, (cam.k - LABEL_FADE[0]) / (LABEL_FADE[1] - LABEL_FADE[0])));
    ctx.font = `${this.isLocal ? 10 : 12}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.label;
    for (let i = 0; i < nodes.length; i++) {
      if (!onScreen(i)) continue;
      let alpha = fade;
      if (lit(i)) alpha = 1;
      else if (hover >= 0) alpha = fade * 0.3;
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillText(nodes[i].label, x(i), y(i) + nodeRadius(nodes[i].degree) * this.options.nodeSize + 4);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- view lifecycle ----------

  onShow() {
    renderDocStats(null);
    this.visible = true;
    this.resize();
    if (this.stale) {
      this.stale = false;
      this.update();
    }
    if (!this.fitted) this.fit({ auto: true });
    this.requestDraw();
  }

  onHide() {
    this.visible = false;
  }

  destroy() {
    this.visible = false;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.updateTimer);
    this.resizeObserver.disconnect();
    this.store.removeEventListener('change', this.onStoreChange);
    this.store.removeEventListener('links', this.onStoreChange);
    this.workspace.removeEventListener('change', this.onStoreChange);
    this.worker.terminate();
  }

  serialize() { return { type: 'graph' }; }
}
