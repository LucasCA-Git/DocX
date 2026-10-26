'use strict';

// JSON Canvas (https://jsoncanvas.org), the .canvas format of Obsidian: nodes (text, file, link,
// group) on an infinite board and edges between them. Unknown top-level fields are kept.

const NODE_TYPES = new Set(['text', 'file', 'link', 'group']);
// Limits for files from elsewhere (a remote repo): beyond them the board would hang.
const MAX_NODES = 5000;
const MAX_EDGES = 10000;
const MAX_COORD = 1e6;
const MAX_SIZE = 1e5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SIDES = ['top', 'right', 'bottom', 'left'];
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string';

function cleanNode(n) {
  if (!n || !str(n.id) || !NODE_TYPES.has(n.type) || ![n.x, n.y, n.width, n.height].every(num)) return null;
  const node = {
    ...n,
    x: clamp(n.x, -MAX_COORD, MAX_COORD),
    y: clamp(n.y, -MAX_COORD, MAX_COORD),
    width: clamp(n.width, 20, MAX_SIZE),
    height: clamp(n.height, 20, MAX_SIZE),
  };
  if (n.type === 'text' && !str(n.text)) node.text = '';
  if (n.type === 'file' && !str(n.file)) return null;
  if (n.type === 'link' && !str(n.url)) return null;
  if (n.color !== undefined && !str(n.color)) delete node.color;
  return node;
}

function parseCanvas(text) {
  let data;
  try {
    data = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { nodes: [], edges: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { nodes: [], edges: [] };
  const ids = new Set();
  const nodes = [];
  for (const raw of Array.isArray(data.nodes) ? data.nodes : []) {
    if (nodes.length >= MAX_NODES) break;
    const node = cleanNode(raw);
    if (!node || ids.has(node.id)) continue;
    ids.add(node.id);
    nodes.push(node);
  }
  const edges = (Array.isArray(data.edges) ? data.edges : []).slice(0, MAX_EDGES).filter((e) => e && str(e.id) && ids.has(e.fromNode) && ids.has(e.toNode))
    .map((e) => {
      const edge = { ...e };
      if (!SIDES.includes(edge.fromSide)) delete edge.fromSide;
      if (!SIDES.includes(edge.toSide)) delete edge.toSide;
      return edge;
    });
  return { ...data, nodes, edges };
}

// Groups first so they are drawn behind the cards (Obsidian does the same).
function serializeCanvas(canvas) {
  const nodes = [...canvas.nodes.filter((n) => n.type === 'group'), ...canvas.nodes.filter((n) => n.type !== 'group')];
  return JSON.stringify({ ...canvas, nodes, edges: canvas.edges }, null, '\t');
}

function sidePoint(n, side) {
  switch (side) {
    case 'top': return { x: n.x + n.width / 2, y: n.y };
    case 'bottom': return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left': return { x: n.x, y: n.y + n.height / 2 };
    default: return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

// The side of `n` facing point p (for edges without explicit sides).
function closestSide(n, p) {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const dx = (p.x - cx) / (n.width / 2);
  const dy = (p.y - cy) / (n.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

const inside = (n, r) => n.x >= r.x && n.y >= r.y && n.x + n.width <= r.x + r.width && n.y + n.height <= r.y + r.height;

// Nodes fully inside a rectangle (selection box), groups excluded unless fully inside too.
function nodesInRect(nodes, rect) {
  return nodes.filter((n) => inside(n, rect));
}

// Cards inside a group move with it.
function nodesInGroup(nodes, group) {
  return nodes.filter((n) => n !== group && n.type !== 'group' && inside(n, group));
}

function bounds(nodes) {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function newId() {
  let id = '';
  for (let i = 0; i < 16; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

// The canvas text with file cards following a rename (map: old path → new path), or null when
// nothing pointed there.
function renameInCanvas(text, map) {
  const canvas = parseCanvas(text);
  let changed = false;
  for (const n of canvas.nodes) {
    if (n.type === 'file' && map(n.file) !== n.file) {
      n.file = map(n.file);
      changed = true;
    }
  }
  return changed ? serializeCanvas(canvas) : null;
}

module.exports = { renameInCanvas, parseCanvas, serializeCanvas, sidePoint, closestSide, nodesInRect, nodesInGroup, bounds, newId, SIDES };
