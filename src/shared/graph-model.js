'use strict';

// Graph View math that does not need a canvas: which nodes and links to show, node sizes, the
// camera (pan/zoom), hit testing, and where new nodes start. Positions live in a Float32Array
// [x0, y0, x1, y1, …] in node order, as the simulation worker sends them.

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const MIN_HIT_PX = 6;

const { parseQuery } = require('./search-query');

const labelOf = (id, type) => {
  const base = id.split('/').pop();
  return type === 'note' ? base.replace(/\.(md|markdown)$/i, '') : base;
};

// A node test from a query in the search syntax, applied to file paths and tags only (fast enough
// to run on every graph update): words/path:/file: on the path, tag:, -negation, OR, /regex/.
function nodeMatcher(query, tagsOf) {
  const groups = parseQuery(query ?? '');
  if (!groups.length) return () => true;
  const fold = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Regexes compiled once; very long patterns are refused (a typed /(a+)+/ freezes nothing big).
  for (const group of groups) {
    for (const term of group) {
      if (term.kind !== 'regex') continue;
      try {
        term.re = term.value.length <= 200 ? new RegExp(term.value, term.flags.replace(/[^imsu]/g, '') || 'i') : null;
      } catch {
        term.re = null;
      }
    }
  }
  const test = (term, node) => {
    const id = fold(node.id);
    const value = fold(term.value);
    if (term.kind === 'tag') {
      const tags = node.type === 'tag' ? [node.id.slice(1)] : tagsOf(node.id);
      return tags.some((t) => fold(t) === value || fold(t).startsWith(`${value}/`));
    }
    if (term.kind === 'file') return fold(node.id.split('/').pop()).includes(value);
    if (term.kind === 'regex') return Boolean(term.re?.test(node.id));
    return id.includes(value);
  };
  return (node) => groups.some((group) => group.every((term) => test(term, node) !== term.negate));
}

// options: attachments (show files that are not notes), unresolved (links to missing notes),
// orphans (nodes without links), tags (tags as nodes), search (filter in the search syntax),
// groups ([{ query, color }] → node.group = index of the first matching group, or -1).
// center/depth: local graph, the center node plus nodes up to `depth` links away from it.
function graphData(index, {
  attachments = true, unresolved = false, orphans = true, tags = false, search = '', groups = null, center = null, depth = 1,
} = {}) {
  const base = index.graph({ includeUnresolved: unresolved });
  let { nodes, edges } = base;
  if (tags) {
    const tagNodes = new Map();
    const tagEdges = [];
    for (const n of nodes) {
      if (n.type !== 'note') continue;
      for (const tag of index.tagsOf(n.id)) {
        const key = tag.toLowerCase();
        if (!tagNodes.has(key)) tagNodes.set(key, { id: `#${tag}`, type: 'tag' });
        tagEdges.push({ source: n.id, target: tagNodes.get(key).id });
      }
    }
    nodes = [...nodes, ...tagNodes.values()];
    edges = [...edges, ...tagEdges];
  }
  const tagsOf = (id) => index.tagsOf(id);
  const matches = nodeMatcher(search, tagsOf);
  let kept = nodes.filter((n) => (attachments || n.type !== 'attachment') && matches(n));
  let ids = new Set(kept.map((n) => n.id));
  let links = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target }));
  if (center !== null) {
    const near = new Set(ids.has(center) ? [center] : []);
    let frontier = new Set(near);
    for (let d = 0; d < depth && frontier.size; d++) {
      const next = new Set();
      for (const { source, target } of links) {
        if (frontier.has(source) && !near.has(target)) next.add(target);
        if (frontier.has(target) && !near.has(source)) next.add(source);
      }
      for (const id of next) near.add(id);
      frontier = next;
    }
    kept = kept.filter((n) => near.has(n.id));
    ids = near;
    links = links.filter((e) => ids.has(e.source) && ids.has(e.target));
  }
  const degree = new Map();
  for (const { source, target } of links) {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  if (!orphans) {
    kept = kept.filter((n) => degree.has(n.id) || n.id === center);
    ids = new Set(kept.map((n) => n.id));
  }
  const groupTests = (groups ?? []).filter((g) => g?.query?.trim()).map((g) => nodeMatcher(g.query, tagsOf));
  return {
    nodes: kept.map((n) => {
      const node = { id: n.id, type: n.type, label: n.type === 'tag' ? n.id : labelOf(n.id, n.type), degree: degree.get(n.id) ?? 0 };
      if (groups) node.group = groupTests.findIndex((t) => t(n));
      return node;
    }),
    links,
  };
}

function nodeRadius(degree) {
  return Math.min(24, 3 + Math.sqrt(degree) * 1.6);
}

// Camera: screen = world * k + (x, y).
function toWorld(cam, sx, sy) {
  return { x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k };
}

function toScreen(cam, wx, wy) {
  return { x: wx * cam.k + cam.x, y: wy * cam.k + cam.y };
}

// Zooms by `factor` around the screen point (sx, sy), which stays over the same world point.
function zoomAt(cam, factor, sx, sy) {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.k * factor));
  const w = toWorld(cam, sx, sy);
  return { k, x: sx - w.x * k, y: sy - w.y * k };
}

// Index of the node nearest to world point (wx, wy) within its radius (never smaller than a few
// screen pixels), or -1.
function hitTest(nodes, positions, wx, wy, k) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = positions[i * 2] - wx;
    const dy = positions[i * 2 + 1] - wy;
    const dist = Math.hypot(dx, dy);
    const reach = Math.max(nodeRadius(nodes[i].degree), MIN_HIT_PX / k);
    if (dist <= reach && dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

// Start positions: known nodes keep theirs, a new node starts at the middle of its known
// neighbours (so a new link grows out of the right place), otherwise somewhere near the centre.
function placeNewNodes(nodes, links, known, random = Math.random) {
  const neighbours = new Map();
  for (const { source, target } of links) {
    if (!neighbours.has(source)) neighbours.set(source, []);
    if (!neighbours.has(target)) neighbours.set(target, []);
    neighbours.get(source).push(target);
    neighbours.get(target).push(source);
  }
  let cx = 0;
  let cy = 0;
  for (const p of known.values()) {
    cx += p.x / known.size;
    cy += p.y / known.size;
  }
  const spread = 40 + Math.sqrt(nodes.length) * 20;
  return nodes.map(({ id }) => {
    const at = known.get(id);
    if (at) return { id, x: at.x, y: at.y };
    const near = (neighbours.get(id) ?? []).map((n) => known.get(n)).filter(Boolean);
    if (near.length) {
      const x = near.reduce((s, p) => s + p.x, 0) / near.length;
      const y = near.reduce((s, p) => s + p.y, 0) / near.length;
      return { id, x: x + (random() - 0.5) * 20, y: y + (random() - 0.5) * 20 };
    }
    const angle = random() * Math.PI * 2;
    const dist = Math.sqrt(random()) * spread;
    return { id, x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
  });
}

module.exports = { graphData, nodeRadius, toWorld, toScreen, zoomAt, hitTest, placeNewNodes, MIN_ZOOM, MAX_ZOOM };
