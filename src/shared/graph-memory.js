'use strict';

// Where the user left the graph, per folder: node positions, the nodes they pinned and the
// camera. Opening the graph again (or coming back to a folder) restores it instead of starting the
// layout over. Pure: the graph view keeps the result in localStorage.

const MAX_FOLDERS = 40;
const MAX_NODES = 4000;

const round = (v) => Math.round(v * 10) / 10 || 0;
const finite = (...values) => values.every(Number.isFinite);

// The flat camera { x, y, k } or the 3D orbit camera { tx, ty, tz, distance, yaw, pitch }; null
// when it is neither.
function cleanCam(cam) {
  if (!cam || typeof cam !== 'object') return null;
  if ('distance' in cam) {
    const { tx, ty, tz, distance, yaw, pitch } = cam;
    return finite(tx, ty, tz, distance, yaw, pitch) && distance > 0 ? { tx, ty, tz, distance, yaw, pitch } : null;
  }
  return finite(cam.x, cam.y, cam.k) && cam.k > 0 ? { x: cam.x, y: cam.y, k: cam.k } : null;
}

// memory: a previous result (or anything); layout: { ids, positions (x, y pairs, or x, y, z with
// dims 3), pinned (Set of ids), cam, dims }. Returns a new memory; past MAX_FOLDERS the folders
// left longest ago are dropped. A node is [x, y, pinned] or [x, y, pinned, z].
function rememberLayout(memory, folder, { ids, positions, pinned, cam, dims = 2 }, now = Date.now()) {
  const nodes = {};
  ids.slice(0, MAX_NODES).forEach((id, i) => {
    const x = positions[i * dims];
    const y = positions[i * dims + 1];
    const z = dims === 3 ? positions[i * dims + 2] : 0;
    if (!finite(x, y, z)) return;
    nodes[id] = [round(x), round(y), pinned.has(id) ? 1 : 0];
    if (dims === 3) nodes[id].push(round(z));
  });
  const folders = { ...(memory && typeof memory.folders === 'object' ? memory.folders : {}) };
  folders[folder] = { at: now, cam: cleanCam(cam), nodes };
  const keep = Object.entries(folders).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, MAX_FOLDERS);
  return { folders: Object.fromEntries(keep) };
}

// { nodes: Map id → { x, y, z?, pinned }, cam | null }, or null when the folder was never saved.
function recallLayout(memory, folder) {
  const saved = memory?.folders?.[folder];
  if (!saved || typeof saved.nodes !== 'object' || saved.nodes === null) return null;
  const nodes = new Map();
  for (const [id, value] of Object.entries(saved.nodes)) {
    if (!Array.isArray(value) || !finite(value[0], value[1])) continue;
    const node = { x: value[0], y: value[1] };
    if (Number.isFinite(value[3])) node.z = value[3];
    node.pinned = value[2] === 1;
    nodes.set(id, node);
  }
  return { nodes, cam: cleanCam(saved.cam) };
}

module.exports = { rememberLayout, recallLayout, MAX_FOLDERS };
