import { el, icon, iconButton } from '../dom';
import { renderDocStats, notice } from '../status';
import {
  graphData, nodeRadius, toWorld, zoomAt, hitTest,
} from '../../shared/graph-model';
import { makeStarfield, twinkle } from '../../shared/graph-physics';
import { createTraffic, stepTraffic, trafficGlyphs } from '../../shared/space-traffic';
import { galaxyLayout, parentFolder } from '../../shared/graph-galaxy';
import { rememberLayout, recallLayout } from '../../shared/graph-memory';
import {
  glowSprite, folderHue, galaxySprite, sunSprite, sprite,
} from '../graph-sprites';

const OPTIONS_KEY = 'docs.graph';
// Where the user left the global graph, per folder (see graph-memory.js).
const LAYOUT_KEY = 'docs.graph.layout';
// The same for the 3D graph (depth and orbit camera), kept apart.
const LAYOUT_KEY_3D = 'docs.graph.layout3d';
// In 3D a click waits this long for a second click (a double click flies to the node).
const CLICK_DELAY_MS = 250;
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
  background: '#1e1e1e',
};

const LINK_BATCH = 256;

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
  ship: '#c9d4ff',
};
const TRAFFIC_LEVELS = ['calmo', 'movimentado', 'frotas', 'batalhas', 'guerra total'];
const TRAFFIC_FONT = 'ui-monospace, "Cascadia Code", Consolas, monospace';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
// Above this many nodes the sky stops animating on its own (the simulation still redraws it).
const SKY_ANIMATION_MAX_NODES = 3000;

export const DEFAULT_FORCES = { center: 0.04, repel: 90, link: 0.6, distance: 40, spin: 1, spacing: 1 };
const GROUP_COLORS = ['#e9973f', '#4fb3a9', '#e05d6f', '#5b8def', '#b07de8', '#7cc56b'];

// The 3D Graph View bundle (three.js, vendor/graph3d) is loaded once, the first time it is used.
let graph3dReady = null;
function loadGraph3D() {
  graph3dReady ??= new Promise((resolve, reject) => {
    const script = el('script', { src: 'vendor/graph3d/graph3d.js' });
    script.addEventListener('load', () => resolve(window.DocxGraph3D));
    script.addEventListener('error', () => {
      graph3dReady = null;
      script.remove();
      reject(new Error('Não foi possível carregar o grafo 3D'));
    });
    document.head.append(script);
  });
  return graph3dReady;
}

function loadOptions(key) {
  const defaults = {
    attachments: true, unresolved: false, orphans: true, tags: false, arrows: false, search: '',
    groups: [], depth: 1, nodeSize: 1, mode: '3d', modeChosen: false, autoRotate: true, constellation: true, traffic: true, trafficLevel: 1, gravity: true, pinOnDrag: true, galaxies: true, folder: '', forces: { ...DEFAULT_FORCES }, open: { panel: true, filters: true, groups: false, display: false, forces: false },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key)) ?? {};
    return {
      ...defaults,
      ...saved,
      groups: Array.isArray(saved.groups) ? saved.groups.filter((g) => typeof g?.query === 'string' && /^#[0-9a-f]{6}$/i.test(g.color)) : [],
      forces: { ...DEFAULT_FORCES, ...saved.forces },
      folder: typeof saved.folder === 'string' ? saved.folder : '',
      // The graph opens in 3D until the user picks a mode with the switch.
      mode: saved.modeChosen === true && saved.mode === '2d' ? '2d' : '3d',
      modeChosen: saved.modeChosen === true,
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
// The global graph can also be seen in 3D (the 2D/3D switch): the worker lays it out in space and
// graph3d/scene.js draws it with WebGL under this canvas, which then only gets labels and ships.
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
    // Ships and asteroids crossing the sky (global graph only; see space-traffic.js).
    this.traffic = local ? null : createTraffic();
    this.trafficClock = 0;

    this.canvas = el('canvas', { class: 'graph-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.controls = el('div', { class: 'graph-controls' });
    this.trail = el('div', { class: 'graph-trail' });
    // 3D: the WebGL scene (null in 2D), and where the nodes were when the mode was switched.
    this.scene3d = null;
    this.carry = null;
    this.modeSwitch = local ? null : el('div', { class: 'graph-mode', role: 'group', 'aria-label': 'Modo do grafo' });
    this.content = el('div', { class: 'view-content graph-content' }, this.canvas, this.trail, this.controls, this.modeSwitch);
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
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    // In 3D the right button pans the camera: no context menu on the graph.
    this.canvas.addEventListener('contextmenu', (e) => {
      if (!this.is3D) return;
      e.preventDefault();
      e.stopPropagation();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.content);

    this.onStoreChange = () => this.scheduleUpdate();
    store.addEventListener('change', this.onStoreChange);
    store.addEventListener('links', this.onStoreChange);
    if (local) workspace.addEventListener('change', this.onStoreChange);
    this.renderModeSwitch();
    if (!local && this.options.mode === '3d') this.setMode('3d');
    else this.update();
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
        this.isLocal ? null : visual('traffic', 'Naves e asteroides no céu', () => this.requestDraw()),
        this.isLocal ? null : this.trafficSlider(save),
        this.isLocal ? null : toggle('galaxies', 'Galáxias (pastas com sol)'),
        this.isLocal ? null : visual('autoRotate', 'Girar sozinho quando parado (3D)', () => {
          this.scene3d?.touch();
          this.requestDraw();
        }),
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

  get is3D() {
    return Boolean(this.scene3d);
  }

  get dims() {
    return this.is3D ? 3 : 2;
  }

  get layoutKey() {
    return this.is3D ? LAYOUT_KEY_3D : LAYOUT_KEY;
  }

  // The 2D/3D switch, bottom left of the global graph.
  renderModeSwitch() {
    if (!this.modeSwitch) return;
    const want = this.options.mode;
    const button = (mode, iconName, label, title) => el('button', {
      class: `graph-mode-button${want === mode ? ' is-active' : ''}`,
      title,
      'aria-pressed': String(want === mode),
      onclick: () => {
        this.options.modeChosen = true;
        this.setMode(mode);
      },
    }, icon(iconName, 15), el('span', { text: label }));
    this.modeSwitch.replaceChildren(
      button('2d', 'square', '2D', 'Grafo plano'),
      button('3d', 'cube', '3D', 'Grafo em 3D: arraste para girar, roda para zoom, botão direito para mover, clique duplo para voar até um nó'),
    );
  }

  // Switches between the flat graph and the 3D one. The layout of the mode being left is saved;
  // the other mode's saved layout comes back, or the current one is carried over (opening up in
  // depth). Without WebGL the graph stays flat.
  // persist: false keeps the user's choice (a GPU reset falls back to 2D only for now). A click on
  // the switch while the 3D bundle is loading is applied once the first switch is done.
  async setMode(mode, { persist = true } = {}) {
    if (this.isLocal || this.destroyed) return;
    const to3D = mode === '3d';
    if (persist) {
      this.options.mode = to3D ? '3d' : '2d';
      this.saveOptions();
      this.renderModeSwitch();
    }
    if (this.switching) {
      this.pendingMode = mode;
      return;
    }
    if (to3D === this.is3D && this.shownFolder !== null) return;
    this.switching = true;
    try {
      let lib = null;
      if (to3D && !this.scene3d) {
        try {
          lib = await loadGraph3D();
        } catch (err) {
          lib = err;
        }
        if (this.destroyed) return;
      }
      // Where the nodes are now (and which are pinned), for the other mode to start from.
      this.saveLayout();
      const carry = new Map(this.nodes.map((n, i) => [n.id, {
        x: this.positions[i * this.dims], y: this.positions[i * this.dims + 1], pinned: this.pinnedNodes.has(n.id),
      }]));
      if (to3D && !this.scene3d) {
        try {
          if (lib instanceof Error || !lib) throw lib ?? new Error('Grafo 3D indisponível');
          const scene = new lib.Graph3D({
            host: this.content,
            onContextLost: () => {
              if (this.scene3d === scene) this.on3DLost();
            },
          });
          this.scene3d = scene;
        } catch (err) {
          console.error(err);
          notice('Não deu para abrir o grafo em 3D neste computador (sem WebGL). O grafo continua em 2D.', { error: true });
          this.options.mode = '2d';
          this.options.modeChosen = true;
          this.saveOptions();
          this.renderModeSwitch();
        }
      } else if (!to3D && this.scene3d) {
        this.scene3d.dispose();
        this.scene3d = null;
      }
      this.content.classList.toggle('is-3d', this.is3D);
      if (this.is3D) this.showHint();
      this.canvas.dataset.mode = this.is3D ? '3d' : '2d';
      this.carry = carry;
      this.shownFolder = null;
      this.signature = '';
      this.fitted = false;
      this.hover = -1;
      this.width = 0;
      this.resize();
      this.update();
    } finally {
      this.switching = false;
    }
    const pending = this.pendingMode;
    this.pendingMode = null;
    if (pending && (pending === '3d') !== this.is3D) this.setMode(pending, { persist: false });
  }

  // How to move around in 3D, shown for a few seconds each time the graph enters 3D.
  showHint() {
    this.hint?.remove();
    this.hint = el('div', { class: 'graph-hint', text: 'Arraste para girar · roda: zoom · botão direito: mover · duplo clique num nó: voar até ele · Alt + arrastar: mover um nó' });
    this.content.append(this.hint);
    const hint = this.hint;
    setTimeout(() => hint.classList.add('is-fading'), 6000);
    setTimeout(() => hint.remove(), 7000);
  }

  on3DLost() {
    if (this.destroyed) return;
    notice('O 3D parou de funcionar (a placa de vídeo reiniciou). O grafo voltou para 2D por enquanto.', { error: true });
    if (this.switching) this.pendingMode = '2d';
    else this.setMode('2d', { persist: false });
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
      if (saved?.cam && this.is3D === ('distance' in saved.cam)) {
        if (this.is3D) this.scene3d.setOrbit(saved.cam);
        else this.cam = saved.cam;
        this.fitted = true;
      }
    }
    this.shownFolder = folder;
    const D = this.dims;
    const carry = this.carry;
    this.carry = null;
    const old = new Map(this.nodes.map((n, i) => [n.id, i]));
    const positions = new Float32Array(nodes.length * D);
    const restored = nodes.map((n, i) => {
      const j = old.get(n.id);
      if (j !== undefined) {
        for (let k = 0; k < D; k++) positions[i * D + k] = this.positions[j * D + k];
        return null;
      }
      // Saved in this mode, or (just switched) where it was in the other mode.
      const back = saved?.nodes.get(n.id) ?? carry?.get(n.id) ?? null;
      positions[i * D] = back?.x ?? 0;
      positions[i * D + 1] = back?.y ?? 0;
      if (D === 3) positions[i * D + 2] = back?.z ?? 0;
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
    if (this.is3D) {
      this.scene3d.setGraph(nodes, this.linkIndex);
      this.scene3d.setPositions(positions);
    }
    this.worker.postMessage({
      type: 'graph',
      gen: this.gen,
      dims: D,
      nodes: nodes.map((n, i) => ({
        id: n.id, degree: n.degree, type: n.type, radius: n.radius, anchor: n.anchor,
        ...(restored[i] ? {
          x: restored[i].x, y: restored[i].y, ...(Number.isFinite(restored[i].z) ? { z: restored[i].z } : {}), pinned: restored[i].pinned,
        } : {}),
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
      this.scene3d?.setPositions(data.positions);
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
      return JSON.parse(localStorage.getItem(this.layoutKey));
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
      ids: this.nodes.map((n) => n.id), positions: this.positions, pinned: this.pinnedNodes, cam: this.is3D ? this.scene3d.getOrbit() : this.cam, dims: this.dims,
    });
    try {
      localStorage.setItem(this.layoutKey, JSON.stringify(memory));
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
    this.scene3d?.resize(w, h, dpr);
    this.requestDraw();
  }

  // Zooms so every node fits in the view. The button (auto = false) also stops the camera from
  // following the layout.
  fit({ auto = false } = {}) {
    if (!this.nodes.length || !this.width) return;
    if (this.is3D) {
      this.scene3d.fit();
      if (!auto) this.fitted = true;
      this.requestDraw();
      return;
    }
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
    if (this.is3D) return this.scene3d.pick(p.x, p.y);
    const w = toWorld(this.cam, p.x, p.y);
    return hitTest(this.nodes, this.positions, w.x, w.y, this.cam.k);
  }

  onPointerDown(event) {
    // 3D: the right button (or Shift + left) slides the camera instead of turning it.
    const pan = this.is3D && (event.button === 2 || (event.button === 0 && event.shiftKey));
    if (event.button !== 0 && !pan) return;
    // A new press cancels a click still waiting for its double click.
    clearTimeout(this.clickTimer);
    this.fitted = true;
    this.scene3d?.touch();
    const p = this.local(event);
    // The node is kept by id: the graph can be rebuilt (a save, a sync) in the middle of a drag.
    const index = pan ? -1 : this.nodeAt(event);
    const hit = index >= 0 ? this.nodes[index].id : null;
    // 3D: dragging turns the view, even over a star or galaxy; Alt + drag moves the node.
    const grab = this.is3D && !event.altKey ? null : hit;
    this.pointer = { id: grab, hit, start: p, last: p, moved: false, pan };
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
    if (this.is3D) {
      // A node moves on the plane facing the camera; empty space turns (or slides) the view.
      if (drag.id !== null) {
        const index = this.nodes.findIndex((n) => n.id === drag.id);
        if (index >= 0) {
          const w = this.scene3d.dragPoint(index, p.x, p.y);
          this.worker.postMessage({ type: 'drag', id: drag.id, x: w.x, y: w.y, z: w.z });
        }
        this.scene3d.touch();
      } else if (drag.pan) {
        this.scene3d.pan(p.x - drag.last.x, p.y - drag.last.y);
      } else {
        this.scene3d.rotate(p.x - drag.last.x, p.y - drag.last.y);
      }
      this.requestDraw();
    } else if (drag.id !== null) {
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
    if (!drag || drag.hit === null || drag.moved) return;
    const node = this.nodes.find((n) => n.id === drag.hit);
    if (!node) return;
    const newTab = event.ctrlKey || event.metaKey;
    // 3D: wait a moment, the click may be the first half of a double click (fly to the node).
    if (this.is3D) {
      clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => this.activate(node, newTab), CLICK_DELAY_MS);
      return;
    }
    this.activate(node, newTab);
  }

  // What a click on a node does: enter a galaxy, search a tag, open (or create) the note.
  activate(node, newTab) {
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

  // Double click: in 3D, on a node, the camera flies to it; on empty space inside a galaxy, back
  // up to the folder above (both modes).
  onDoubleClick(event) {
    const index = this.nodeAt(event);
    if (this.is3D && index >= 0) {
      clearTimeout(this.clickTimer);
      this.fitted = true;
      this.scene3d.flyTo(index, this.radiusOf(index));
      this.requestDraw();
      this.scheduleLayoutSave();
      return;
    }
    if (this.galaxiesOn && this.options.folder && index < 0) this.showFolder(parentFolder(this.options.folder));
  }

  onWheel(event) {
    event.preventDefault();
    this.fitted = true;
    if (this.is3D) {
      this.scene3d.zoom(Math.exp(-event.deltaY * 0.0015));
      this.requestDraw();
      this.scheduleLayoutSave();
      return;
    }
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
    COLORS.background = v('--background-primary', COLORS.background);
  }

  draw() {
    const {
      ctx, cam, dpr, nodes, positions, hover,
    } = this;
    if (!this.width) return;
    this.themeColors();
    if (this.is3D) {
      this.draw3D();
      return;
    }
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

  // The 3D scene draws itself (and the labels and ships on this canvas); it says whether something
  // keeps moving (twinkling, turning, flying), and then asks for the next frame.
  draw3D() {
    const sky = this.options.constellation;
    const palette = sky ? SKY : COLORS;
    const moving = this.scene3d.render({
      hover: this.hover,
      neighbours: this.neighbours,
      pinned: this.pinnedNodes,
      folder: this.galaxiesOn ? this.options.folder : '',
      overlay: this.ctx,
      traffic: this.traffic,
      trafficOn: this.options.traffic,
      trafficLevel: this.options.trafficLevel,
      autoRotate: this.options.autoRotate,
      busy: Boolean(this.pointer),
      reducedMotion: REDUCED_MOTION.matches,
      style: {
        sky,
        palette,
        highlight: COLORS.highlight,
        groupColors: this.options.groups.map((g) => g.color),
        nodeSize: this.options.nodeSize,
        background: COLORS.background,
        label: palette.label,
        link: palette.link,
        ship: SKY.ship,
      },
    });
    // Big graphs stop animating on their own (like the flat sky), unless turning or flying.
    if (moving && (this.nodes.length <= SKY_ANIMATION_MAX_NODES || this.options.autoRotate || this.scene3d.flight)) this.requestDraw();
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
    this.drawTraffic();
  }

  // How busy the sky is, from a calm sky to all-out war; the label names the level.
  trafficSlider(save) {
    const level = Math.min(TRAFFIC_LEVELS.length, Math.max(1, Math.round(this.options.trafficLevel) || 1));
    const name = el('span', { class: 'graph-traffic-level', text: TRAFFIC_LEVELS[level - 1] });
    const input = el('input', {
      type: 'range', min: 1, max: TRAFFIC_LEVELS.length, step: 1, class: 'graph-slider',
    });
    input.value = level;
    input.addEventListener('input', () => {
      this.options.trafficLevel = Number(input.value);
      name.textContent = TRAFFIC_LEVELS[this.options.trafficLevel - 1];
      save();
    });
    return el('label', { class: 'graph-slider-row' }, el('span', {}, 'Tráfego: ', name), input);
  }

  // Ships, fleets and asteroids drifting by, faint, behind the notes. Stops with reduced motion.
  drawTraffic() {
    const now = performance.now();
    const dt = this.trafficClock ? (now - this.trafficClock) / 1000 : 0;
    this.trafficClock = now;
    if (!this.traffic || !this.options.traffic || REDUCED_MOTION.matches) return;
    const { ctx, width, height } = this;
    stepTraffic(this.traffic, dt, width, height, this.options.trafficLevel);
    const glyphs = trafficGlyphs(this.traffic);
    if (!glyphs.length) return;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let size = 0;
    for (const g of glyphs) {
      if (g.size !== size) {
        size = g.size;
        ctx.font = `${size}px ${TRAFFIC_FONT}`;
      }
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = g.color ?? SKY.ship;
      ctx.fillText(g.text, g.x, g.y);
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
    this.destroyed = true;
    this.visible = false;
    clearTimeout(this.clickTimer);
    this.scene3d?.dispose();
    this.scene3d = null;
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
