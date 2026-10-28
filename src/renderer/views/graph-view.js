import { el, icon, iconButton } from '../dom';
import { renderDocStats } from '../status';
import {
  graphData, nodeRadius, toWorld, zoomAt, hitTest,
} from '../../shared/graph-model';
import { makeStarfield, twinkle } from '../../shared/graph-physics';
import { galaxyLayout, parentFolder } from '../../shared/graph-galaxy';
import { rememberLayout, recallLayout } from '../../shared/graph-memory';

const OPTIONS_KEY = 'docs.graph';
// Where the user left the global graph, per folder (see graph-memory.js).
const LAYOUT_KEY = 'docs.graph.layout';
const LAYOUT_SAVE_MS = 3000;
const UPDATE_DELAY_MS = 300;
const DRAG_THRESHOLD_PX = 3;
// Labels fade in between these zoom levels (always shown for the hovered node and neighbours).
const LABEL_FADE = [0.55, 1.1];

const COLORS = {
  note: '#a3a3a3',
  board: '#c678dd',
  sun: '#e8a33d',
  galaxy: '#8e7cf0',
  attachment: '#d9b23a',
  unresolved: '#5c5c5c',
  tag: '#4fb3a9',
  link: 'rgba(160, 160, 160, 0.28)',
  highlight: '#7f6df2',
  label: '#dadada',
};

const LINK_BATCH = 256;
const SPRITE_SIZE = 64;

// Constellation look: a night sky, notes as glowing stars, links as faint star lines.
const SKY = {
  stars: makeStarfield(320, 2026),
  note: '#d6e4ff',
  board: '#e0a8ff',
  sun: '#ffc857',
  galaxy: '#b9a8ff',
  attachment: '#ffd27a',
  unresolved: '#6b7393',
  tag: '#7ee0d4',
  link: 'rgba(150, 175, 255, 0.38)',
  glow: 'rgba(120, 150, 255, 0.07)',
  label: '#c9d4ff',
};
// Above this many nodes the sky stops animating on its own (the simulation still redraws it).
const SKY_ANIMATION_MAX_NODES = 3000;

const withAlpha = (color, a) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return `rgba(255, 255, 255, ${a})`;
  const n = parseInt(hex[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// A star: white core, colored halo fading out. Drawn at twice the node's radius.
const GLOWS = new Map();
function glowSprite(color) {
  if (!GLOWS.has(color)) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const c = canvas.getContext('2d');
    const half = SPRITE_SIZE / 2;
    const g = c.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.16, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.3, withAlpha(color, 0.95));
    g.addColorStop(0.55, withAlpha(color, 0.28));
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    GLOWS.set(color, canvas);
  }
  return GLOWS.get(color);
}

// Each folder keeps its own color (from its path): its galaxy, and the sky while inside it.
function folderHue(folder) {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (Math.imul(h, 31) + folder.charCodeAt(i)) >>> 0;
  return h % 360;
}

// A spiral galaxy seen from above: bright core, two arms of stars, soft disc. Drawn at 1.6x the
// node's radius and turned a little every frame.
const GALAXIES = new Map();
function galaxySprite(hue) {
  if (!GALAXIES.has(hue)) {
    const size = 160;
    const half = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    const disc = c.createRadialGradient(half, half, 0, half, half, half);
    disc.addColorStop(0, 'rgba(255, 250, 235, 1)');
    disc.addColorStop(0.12, `hsla(${hue}, 90%, 85%, 0.9)`);
    disc.addColorStop(0.45, `hsla(${hue}, 70%, 60%, 0.22)`);
    disc.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = disc;
    c.fillRect(0, 0, size, size);
    const rand = (() => {
      let a = hue * 7919 + 1;
      return () => {
        a = (a * 16807) % 2147483647;
        return a / 2147483647;
      };
    })();
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 140; i++) {
        const t = i / 140;
        const angle = arm * Math.PI + t * Math.PI * 2.6;
        const dist = 6 + t * (half - 10);
        const spread = 3 + t * 9;
        const x = half + Math.cos(angle) * dist + (rand() - 0.5) * spread;
        const y = half + Math.sin(angle) * dist + (rand() - 0.5) * spread;
        c.globalAlpha = (1 - t) * 0.8 + 0.15;
        c.fillStyle = rand() < 0.3 ? '#ffffff' : `hsl(${hue}, 85%, ${70 + rand() * 20}%)`;
        c.fillRect(x, y, 1 + rand() * 1.4, 1 + rand() * 1.4);
      }
    }
    GALAXIES.set(hue, canvas);
  }
  return GALAXIES.get(hue);
}

// A sun: white-hot center, yellow body, orange corona. Drawn at 2.6x the node's radius.
let SUN = null;
function sunSprite() {
  if (!SUN) {
    SUN = document.createElement('canvas');
    SUN.width = SPRITE_SIZE * 2;
    SUN.height = SPRITE_SIZE * 2;
    const c = SUN.getContext('2d');
    const half = SPRITE_SIZE;
    const g = c.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, 'rgba(255, 255, 245, 1)');
    g.addColorStop(0.2, 'rgba(255, 236, 160, 1)');
    g.addColorStop(0.36, 'rgba(255, 196, 70, 0.95)');
    g.addColorStop(0.5, 'rgba(255, 140, 40, 0.4)');
    g.addColorStop(0.75, 'rgba(255, 110, 30, 0.1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, half * 2, half * 2);
  }
  return SUN;
}

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

export const DEFAULT_FORCES = { center: 0.04, repel: 90, link: 0.6, distance: 40, spin: 1, spacing: 1 };
const GROUP_COLORS = ['#e9973f', '#4fb3a9', '#e05d6f', '#5b8def', '#b07de8', '#7cc56b'];

function loadOptions(key) {
  const defaults = {
    attachments: true, unresolved: false, orphans: true, tags: false, arrows: false, search: '',
    groups: [], depth: 1, nodeSize: 1, constellation: true, gravity: true, pinOnDrag: true, galaxies: true, folder: '', forces: { ...DEFAULT_FORCES }, open: { panel: true, filters: true, groups: false, display: false, forces: false },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key)) ?? {};
    return {
      ...defaults,
      ...saved,
      groups: Array.isArray(saved.groups) ? saved.groups.filter((g) => typeof g?.query === 'string' && /^#[0-9a-f]{6}$/i.test(g.color)) : [],
      forces: { ...DEFAULT_FORCES, ...saved.forces },
      folder: typeof saved.folder === 'string' ? saved.folder : '',
      open: { ...defaults.open, ...saved.open },
    };
  } catch {
    return defaults;
  }
}

// Global Graph View: every note and attachment, linked by [[links]] and ![[embeds]]. The force
// simulation runs in a worker; this tab draws on a canvas and handles zoom, pan, drag and clicks.
// With galaxies on, it shows one folder at a time: its root file is a sun that the folder's files
// orbit, and its subfolders are galaxies. Clicking a galaxy enters it (only what is inside shows);
// the trail at the top, or a double click on empty space, goes back up (see graph-galaxy.js).
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
    // Nodes the user pinned by dragging, and the folder whose layout is on screen (null: none yet).
    this.pinnedNodes = new Set();
    this.shownFolder = null;

    this.canvas = el('canvas', { class: 'graph-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.controls = el('div', { class: 'graph-controls' });
    this.trail = el('div', { class: 'graph-trail' });
    this.content = el('div', { class: 'view-content graph-content' }, this.canvas, this.trail, this.controls);
    this.renderControls();
    this.el = el('div', { class: `view graph-view${local ? ' is-local' : ''}` },
      local ? null : el('div', { class: 'view-header' }, el('div', { class: 'view-header-title' }, el('span', { class: 'view-header-title-text', text: 'Visualização em gráfico' }))),
      this.content);

    this.worker = new Worker('graph-worker.js');
    this.worker.onmessage = ({ data }) => this.onWorker(data);
    this.sendForces();

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', () => this.endDrag());
    this.canvas.addEventListener('lostpointercapture', () => this.endDrag());
    this.canvas.addEventListener('pointerleave', () => this.setHover(-1));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => {
      if (this.galaxiesOn && this.options.folder && this.nodeAt(e) < 0) this.showFolder(parentFolder(this.options.folder));
    });

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

  // The settings panel closes to a gear button. The global graph remembers it; the local graph
  // starts closed every time.
  get panelOpen() {
    return this.isLocal ? Boolean(this.controlsOpen) : this.options.open.panel !== false;
  }

  set panelOpen(open) {
    if (this.isLocal) this.controlsOpen = open;
    else {
      this.options.open.panel = open;
      this.saveOptions();
    }
  }

  // Filters, color groups, display and forces settings. The local graph
  // has a depth slider instead of the search box.
  renderControls() {
    const save = () => this.saveOptions();
    const toggle = (key, label) => {
      const input = el('input', { type: 'checkbox', checked: this.options[key] });
      input.addEventListener('change', () => this.setOption(key, input.checked));
      return el('label', { class: 'graph-toggle' }, input, label);
    };
    // Switches that change only the look or the physics (no new layout, camera stays).
    const visual = (key, label, apply) => {
      const input = el('input', { type: 'checkbox', checked: this.options[key] });
      input.addEventListener('change', () => {
        this.options[key] = input.checked;
        save();
        apply();
      });
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
      this.sendForces();
    });

    if (!this.panelOpen) {
      this.controls.className = 'graph-controls is-collapsed';
      this.controls.replaceChildren(iconButton('settings', this.isLocal ? 'Opções do grafo local' : 'Opções do grafo', () => {
        this.panelOpen = true;
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
        iconButton('x', 'Fechar opções', () => {
          this.panelOpen = false;
          this.renderControls();
        })),
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
        visual('constellation', 'Constelação (céu estrelado)', () => this.requestDraw()),
        this.isLocal ? null : toggle('galaxies', 'Galáxias (pastas com sol)'),
        toggle('arrows', 'Setas'),
        slider('Tamanho dos nós', this.options.nodeSize, 0.5, 3, 0.1, (v) => {
          this.options.nodeSize = v;
          save();
          this.requestDraw();
        })),
      section('forces', 'Forças',
        visual('gravity', 'Gravidade (movimento contínuo)', () => this.sendForces()),
        visual('pinOnDrag', 'Fixar nós ao arrastar', () => {}),
        this.isLocal ? null : el('button', {
          class: 'graph-add-group',
          text: 'Soltar nós fixos',
          title: 'Os nós que você arrastou voltam a se mover pelas forças',
          onclick: () => this.unpinAll(),
        }),
        force('spacing', 'Espaçamento', 0.3, 3, 0.05),
        force('spin', 'Velocidade da órbita', 0, 3, 0.1),
        force('center', 'Atração ao centro', 0, 0.3, 0.01),
        force('repel', 'Repulsão', 0, 400, 5),
        force('link', 'Força dos links', 0, 1, 0.05),
        force('distance', 'Distância dos links', 10, 300, 5)),
    );
  }

  sendForces() {
    this.worker.postMessage({ type: 'forces', forces: { ...this.options.forces, gravity: this.options.gravity } });
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

  get galaxiesOn() {
    return !this.isLocal && this.options.galaxies;
  }

  // Enters a galaxy ('' = the vault root). The new folder is framed as it settles.
  showFolder(folder) {
    this.saveLayout();
    this.options.folder = folder;
    this.fitted = false;
    this.saveOptions();
    this.update();
  }

  // Where we are: "Cofre › Projetos › Antigos", each step clickable. Hidden at the root.
  renderTrail() {
    const folder = this.galaxiesOn ? this.options.folder : '';
    this.trail.hidden = !folder;
    if (!folder) return;
    const steps = [el('button', { class: 'graph-trail-step', text: 'Cofre', onclick: () => this.showFolder('') })];
    let path = '';
    for (const part of folder.split('/')) {
      path = path ? `${path}/${part}` : part;
      const target = path;
      steps.push(el('span', { class: 'graph-trail-sep', text: '›' }));
      steps.push(target === folder
        ? el('span', { class: 'graph-trail-step is-current', text: part })
        : el('button', { class: 'graph-trail-step', text: part, onclick: () => this.showFolder(target) }));
    }
    this.trail.replaceChildren(icon('arrow-left', 14), ...steps);
    this.trail.firstChild.addEventListener('click', () => this.showFolder(parentFolder(folder)));
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
    let { nodes, links } = graphData(this.store.index, { ...this.options, ...(this.isLocal ? { center } : { depth: 1 }) });
    if (this.galaxiesOn) ({ nodes, links } = galaxyLayout({ nodes, links }, { folder: this.options.folder }));
    this.renderTrail();
    const signature = `${center}@${this.galaxiesOn ? this.options.folder : ''}@${nodes.map((n) => `${n.id}:${n.degree}:${n.group}:${n.type}:${n.anchor}:${n.count}`).join('|')}#${links.map((l) => `${l.source}>${l.target}`).join('|')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    // Another note in the local graph: frame it again.
    if (center !== this.center) this.fitted = false;
    this.center = center;

    // Another folder (or the first time): bring back where the user left it, camera included.
    const folder = this.galaxiesOn ? this.options.folder : '';
    let saved = null;
    if (!this.isLocal && folder !== this.shownFolder) {
      saved = recallLayout(this.readLayouts(), folder);
      this.pinnedNodes = new Set();
      this.nodes = [];
      if (saved?.cam) {
        this.cam = saved.cam;
        this.fitted = true;
      }
    }
    this.shownFolder = folder;
    const old = new Map(this.nodes.map((n, i) => [n.id, i]));
    const positions = new Float32Array(nodes.length * 2);
    const restored = nodes.map((n, i) => {
      const j = old.get(n.id);
      const back = j === undefined ? saved?.nodes.get(n.id) : null;
      positions[i * 2] = j === undefined ? back?.x ?? 0 : this.positions[j * 2];
      positions[i * 2 + 1] = j === undefined ? back?.y ?? 0 : this.positions[j * 2 + 1];
      if (back?.pinned) this.pinnedNodes.add(n.id);
      return back;
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
    this.canvas.dataset.galaxies = nodes.filter((n) => n.type === 'galaxy').length;
    this.worker.postMessage({
      type: 'graph',
      gen: this.gen,
      nodes: nodes.map((n, i) => ({
        id: n.id, degree: n.degree, type: n.type, radius: n.radius, anchor: n.anchor,
        ...(restored[i] ? { x: restored[i].x, y: restored[i].y, pinned: restored[i].pinned } : {}),
      })),
      links,
    });
    this.requestDraw();
  }

  radiusOf(i) {
    const n = this.nodes[i];
    return (n.radius ?? nodeRadius(n.degree)) * this.options.nodeSize;
  }

  // The docs of a galaxy as a little solar system in its middle: a sun and one planet per doc (up
  // to 12) on tilted rings, the inner ones faster. A preview of what entering the galaxy shows.
  drawSystem(ctx, cx, cy, r, count, time, seed) {
    const planets = Math.min(12, Math.max(0, count - 1));
    const alpha = ctx.globalAlpha;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.6);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.18)';
    for (let p = 0; p < planets; p++) {
      const ring = 0.32 + (p % 4) * 0.17;
      ctx.beginPath();
      ctx.arc(0, 0, r * ring, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let p = 0; p < planets; p++) {
      const ring = 0.32 + (p % 4) * 0.17;
      const angle = seed * 2.1 + p * 2.399 + time * 0.03 / Math.sqrt(ring * 4);
      const size = Math.max(1, r * 0.06);
      ctx.globalAlpha = alpha * 0.9;
      ctx.drawImage(glowSprite('#cfe0ff'), Math.cos(angle) * r * ring - size * 2, Math.sin(angle) * r * ring - size * 2, size * 4, size * 4);
    }
    ctx.restore();
    const sun = Math.max(2.5, r * 0.16);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sunSprite(), cx - sun * 2.6, cy - sun * 2.6, sun * 5.2, sun * 5.2);
  }

  onWorker(data) {
    if (data.gen !== this.gen) return;
    // Until the user zooms, pans or drags, the camera follows the layout as it spreads out (and
    // starts zoomed out, where labels are hidden and drawing stays cheap).
    if (data.type === 'tick') {
      this.positions = data.positions;
      if (!this.fitted) this.fit({ auto: true });
      this.requestDraw();
      this.scheduleLayoutSave();
    } else if (data.type === 'end') {
      if (!this.fitted) this.fit({ auto: true });
      this.saveLayout();
    }
  }

  // ---------- remembered layout ----------

  readLayouts() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY));
    } catch {
      return null;
    }
  }

  // Keeps positions, pins and camera of the folder on screen (global graph only).
  saveLayout() {
    clearTimeout(this.layoutTimer);
    this.layoutTimer = 0;
    if (this.isLocal || this.shownFolder === null || !this.nodes.length) return;
    const memory = rememberLayout(this.readLayouts(), this.shownFolder, {
      ids: this.nodes.map((n) => n.id), positions: this.positions, pinned: this.pinnedNodes, cam: this.cam,
    });
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(memory));
    } catch {
      // The layout just won't be remembered.
    }
  }

  scheduleLayoutSave() {
    if (this.isLocal || this.layoutTimer) return;
    this.layoutTimer = setTimeout(() => this.saveLayout(), LAYOUT_SAVE_MS);
  }

  unpinAll() {
    this.pinnedNodes.clear();
    this.worker.postMessage({ type: 'unpin-all' });
    this.saveLayout();
  }

  // ---------- camera ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.content;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (!this.width) {
      // A camera brought back from last time stays as it was.
      if (!this.fitted) this.cam = { x: w / 2, y: h / 2, k: 1 };
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
    if (node.type === 'galaxy') this.showFolder(node.folder);
    else if (node.type === 'tag') this.workspace.searchFor(`tag:${node.id}`);
    else if (node.type === 'unresolved') this.workspace.openLink(node.id, null, { newTab });
    else this.workspace.openFile(node.id, { newTab });
  }

  // Ends a press (also on pointercancel): a dragged node is let go so the simulation can settle.
  endDrag() {
    const drag = this.pointer;
    this.pointer = null;
    if (drag?.moved && drag.id !== null) {
      const pin = Boolean(this.options.pinOnDrag);
      this.worker.postMessage({ type: 'release', id: drag.id, pin });
      const node = this.nodes.find((n) => n.id === drag.id);
      if (pin && node?.type !== 'sun') this.pinnedNodes.add(drag.id);
      else this.pinnedNodes.delete(drag.id);
    }
    if (drag?.moved) this.scheduleLayoutSave();
    return drag;
  }

  onWheel(event) {
    event.preventDefault();
    this.fitted = true;
    const p = this.local(event);
    this.cam = zoomAt(this.cam, Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    this.requestDraw();
    this.scheduleLayoutSave();
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
    const sky = this.options.constellation;
    const time = performance.now() / 16.667;
    const palette = sky ? SKY : COLORS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (sky) this.drawSky(time);
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
    // In the sky, a soft wide stroke first gives the star lines a glow (skipped on big graphs).
    if (sky && this.linkIndex.length <= 1500) {
      ctx.lineWidth = 4 / (cam.k * dpr);
      ctx.strokeStyle = SKY.glow;
      ctx.globalAlpha = hover >= 0 ? 0.35 : 1;
      ctx.beginPath();
      for (const [a, b] of this.linkIndex) {
        ctx.moveTo(x(a), y(a));
        ctx.lineTo(x(b), y(b));
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1 / (cam.k * dpr);
    ctx.strokeStyle = palette.link;
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
      ctx.fillStyle = palette.link;
      ctx.beginPath();
      const size = 6 / cam.k;
      for (const [a, b] of this.linkIndex) {
        if (!onScreen(b)) continue;
        const dx = x(b) - x(a);
        const dy = y(b) - y(a);
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const r = this.radiusOf(b);
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
      const r = this.radiusOf(i);
      ctx.globalAlpha = hover >= 0 && !lit(i) ? 0.25 : 1;
      const color = i === hover || i === centerIndex ? COLORS.highlight : groupColors[nodes[i].group] ?? palette[nodes[i].type];
      if (nodes[i].type === 'galaxy') {
        // Slowly turning spiral; the hovered one glows in the accent color.
        if (i === hover) ctx.drawImage(glowSprite(COLORS.highlight), x(i) - r * 1.4, y(i) - r * 1.4, r * 2.8, r * 2.8);
        ctx.save();
        ctx.translate(x(i), y(i));
        ctx.rotate(-time * 0.004 - i * 1.7);
        ctx.scale(1, 0.82);
        ctx.drawImage(galaxySprite(folderHue(nodes[i].folder)), -r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
        ctx.restore();
        this.drawSystem(ctx, x(i), y(i), r, nodes[i].count, time, i);
      } else if (nodes[i].type === 'sun') {
        // The corona breathes a little.
        const pulse = 1 + 0.06 * Math.sin(time * 0.04 + i);
        const size = r * 2.6 * pulse;
        if (i === hover || i === centerIndex) ctx.drawImage(glowSprite(COLORS.highlight), x(i) - r * 1.6, y(i) - r * 1.6, r * 3.2, r * 3.2);
        ctx.drawImage(sunSprite(), x(i) - size, y(i) - size, size * 2, size * 2);
      } else if (sky) {
        // Stars twinkle a little, each at its own pace; the halo reaches twice the radius.
        ctx.globalAlpha *= 0.8 + 0.2 * Math.sin(time * 0.05 + i * 2.4);
        ctx.drawImage(glowSprite(color), x(i) - r * 2, y(i) - r * 2, r * 4, r * 4);
      } else {
        ctx.drawImage(sprite(color), x(i) - r, y(i) - r, r * 2, r * 2);
      }
      // Pinned by the user: a thin dashed ring.
      if (this.pinnedNodes.size && this.pinnedNodes.has(nodes[i].id)) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = COLORS.highlight;
        ctx.lineWidth = 1 / cam.k;
        ctx.setLineDash([3 / cam.k, 3 / cam.k]);
        ctx.beginPath();
        ctx.arc(x(i), y(i), r + 4 / cam.k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Labels under the nodes, sized in world units so they grow with zoom.
    // The local graph is small: its labels always show.
    const fade = this.isLocal ? 1 : Math.min(1, Math.max(0, (cam.k - LABEL_FADE[0]) / (LABEL_FADE[1] - LABEL_FADE[0])));
    ctx.font = `${this.isLocal ? 10 : 12}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = palette.label;
    // Galaxies and suns are landmarks: their names show from farther away, a bit bigger.
    const big = [];
    for (let i = 0; i < nodes.length; i++) {
      if (!onScreen(i)) continue;
      if (nodes[i].type === 'galaxy' || nodes[i].type === 'sun') {
        big.push(i);
        continue;
      }
      let alpha = fade;
      if (lit(i)) alpha = 1;
      else if (hover >= 0) alpha = fade * 0.3;
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillText(nodes[i].label, x(i), y(i) + this.radiusOf(i) * (sky ? 1.4 : 1) + 4);
    }
    if (big.length) {
      ctx.font = `600 ${Math.max(13, 13 / cam.k)}px Inter, system-ui, sans-serif`;
      for (const i of big) {
        const n = nodes[i];
        ctx.globalAlpha = hover >= 0 && !lit(i) ? 0.35 : n.type === 'galaxy' ? 0.95 : Math.max(fade, 0.8);
        const text = n.type === 'galaxy' ? `${n.label} · ${n.count}` : n.label;
        ctx.fillText(text, x(i), y(i) + this.radiusOf(i) * (n.type === 'galaxy' ? 1.35 : 1.5) + 4);
      }
    }
    ctx.globalAlpha = 1;
    // The sky keeps twinkling even when the layout is still.
    if (sky && nodes.length <= SKY_ANIMATION_MAX_NODES) this.requestDraw();
  }

  // Night sky in screen space: a deep blue gradient and twinkling background stars that move a
  // little with the camera (farther stars move less).
  drawSky(time) {
    const { ctx, dpr, cam, width, height } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.8);
    // Inside a galaxy the sky takes a little of its color.
    const hue = this.galaxiesOn && this.options.folder ? folderHue(this.options.folder) : null;
    g.addColorStop(0, hue === null ? '#16203f' : `hsl(${hue}, 45%, 17%)`);
    g.addColorStop(0.5, hue === null ? '#0c1129' : `hsl(${hue}, 40%, 10%)`);
    g.addColorStop(1, '#04050c');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    for (const s of SKY.stars) {
      const px = (((s.x * width + cam.x * 0.06 * s.depth) % width) + width) % width;
      const py = (((s.y * height + cam.y * 0.06 * s.depth) % height) + height) % height;
      ctx.globalAlpha = twinkle(s.base, s.phase, time);
      ctx.fillRect(px, py, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- view lifecycle ----------

  onShow() {
    renderDocStats(null);
    this.visible = true;
    this.worker.postMessage({ type: 'resume' });
    this.resize();
    if (this.stale) {
      this.stale = false;
      this.update();
    }
    if (!this.fitted) this.fit({ auto: true });
    this.requestDraw();
  }

  onHide() {
    this.saveLayout();
    this.visible = false;
    this.worker.postMessage({ type: 'pause' });
  }

  destroy() {
    this.saveLayout();
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
