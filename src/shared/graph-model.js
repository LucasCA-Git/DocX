'use strict';

// Graph View math that does not need a canvas: which nodes and links to show, node sizes, the
// camera (pan/zoom), hit testing, and where new nodes start. Positions live in a Float32Array
// [x0, y0, x1, y1, …] in node order, as the simulation worker sends them.

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const MIN_HIT_PX = 6;

const labelOf = (id, type) => {
  const base = id.split('/').pop();
  return type === 'note' ? base.replace(/\.(md|markdown)$/i, '') : base;
};

// options: attachments (show files that are not notes), unresolved (links to missing notes),
// orphans (nodes without links), search (substring of the path).
// center/depth: local graph, the center node plus nodes up to `depth` links away from it.
function graphData(index, {
  attachments = true, unresolved = false, orphans = true, search = '', center = null, depth = 1,
} = {}) {
  const { nodes, edges } = index.graph({ includeUnresolved: unresolved });
  const query = search.trim().toLowerCase();
  let kept = nodes.filter((n) => (attachments || n.type !== 'attachment') && (!query || n.id.toLowerCase().includes(query)));
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
  return {
    nodes: kept.map((n) => ({ id: n.id, type: n.type, label: labelOf(n.id, n.type), degree: degree.get(n.id) ?? 0 })),
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
