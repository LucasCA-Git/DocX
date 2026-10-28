'use strict';

// Where the user left the graph, per folder: node positions, the nodes they pinned and the
// camera. Opening the graph again (or coming back to a folder) restores it instead of starting the
// layout over. Pure: the graph view keeps the result in localStorage.

const MAX_FOLDERS = 40;
const MAX_NODES = 4000;

const round = (v) => Math.round(v * 10) / 10 || 0;
const finite = (...values) => values.every(Number.isFinite);

// memory: a previous result (or anything); layout: { ids, positions (x, y pairs), pinned (Set of
// ids), cam }. Returns a new memory; past MAX_FOLDERS the folders left longest ago are dropped.
function rememberLayout(memory, folder, { ids, positions, pinned, cam }, now = Date.now()) {
  const nodes = {};
  ids.slice(0, MAX_NODES).forEach((id, i) => {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    if (finite(x, y)) nodes[id] = [round(x), round(y), pinned.has(id) ? 1 : 0];
  });
  const folders = { ...(memory && typeof memory.folders === 'object' ? memory.folders : {}) };
  folders[folder] = { at: now, cam: finite(cam.x, cam.y, cam.k) ? { x: cam.x, y: cam.y, k: cam.k } : null, nodes };
  const keep = Object.entries(folders).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, MAX_FOLDERS);
  return { folders: Object.fromEntries(keep) };
}

// { nodes: Map id → { x, y, pinned }, cam | null }, or null when the folder was never saved.
function recallLayout(memory, folder) {
  const saved = memory?.folders?.[folder];
  if (!saved || typeof saved.nodes !== 'object' || saved.nodes === null) return null;
  const nodes = new Map();
  for (const [id, value] of Object.entries(saved.nodes)) {
    if (Array.isArray(value) && finite(value[0], value[1])) nodes.set(id, { x: value[0], y: value[1], pinned: value[2] === 1 });
  }
  const cam = saved.cam;
  return { nodes, cam: cam && finite(cam.x, cam.y, cam.k) && cam.k > 0 ? { x: cam.x, y: cam.y, k: cam.k } : null };
}

module.exports = { rememberLayout, recallLayout, MAX_FOLDERS };
