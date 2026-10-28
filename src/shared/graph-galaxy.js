'use strict';

// Galaxy view of the graph: every folder is a galaxy. The view shows one folder at a time (the
// vault root at first): its root file is the sun, its other files orbit the sun (`anchor`), and its
// subfolders are galaxies, one node each with their links merged. Entering a galaxy shows only what
// is inside it. Pure: used by the graph view and the tests.

const { nodeRadius } = require('./graph-model');

// Folder nodes get an id no file can have.
const galaxyId = (folder) => `\0${folder}`;
const isGalaxyId = (id) => id.startsWith('\0');

const dirOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');
// The folder above, '' for the vault root, null above the root.
const parentFolder = (folder) => (folder ? dirOf(folder) : null);
const nameOf = (folder) => folder.split('/').pop();
const stem = (id) => id.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
// Tags and missing notes belong to no folder (they show at the vault root only).
const isFree = (node) => node.type === 'tag' || node.type === 'unresolved';

const ROOT_NAMES = ['readme', 'index', '_index', 'home', 'inicio', 'início'];

// The root file of a folder: the note named like the folder, then README/index, then the most
// linked note (or file, when the folder has no notes). files: [{ id, type, degree }].
function folderSun(folder, files) {
  if (!files.length) return null;
  const notes = files.filter((f) => f.type === 'note');
  if (folder) {
    const name = nameOf(folder).toLowerCase();
    const same = notes.find((f) => stem(f.id) === name);
    if (same) return same.id;
  }
  for (const root of ROOT_NAMES) {
    const found = notes.find((f) => stem(f.id) === root);
    if (found) return found.id;
  }
  const pool = notes.length ? notes : files;
  return [...pool].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0].id;
}

const galaxyRadius = (count) => Math.min(46, 12 + Math.sqrt(count) * 4);
const sunRadius = (degree) => Math.max(10, nodeRadius(degree) * 1.7);

// graph: graphData() output; folder: the galaxy being shown ('' = vault root). Returns
// { nodes, links }: nodes add radius, anchor (the sun's id, or null) and folder (null for free
// nodes); galaxies also have count. Links leaving the folder are dropped.
function galaxyLayout({ nodes, links }, { folder = '' } = {}) {
  const prefix = folder ? `${folder}/` : '';
  const visibleOf = new Map();
  const visible = [];
  const galaxies = new Map();
  const files = [];
  for (const n of nodes) {
    if (isFree(n)) {
      if (folder) continue;
      visibleOf.set(n.id, n.id);
      visible.push({ ...n, folder: null });
      continue;
    }
    if (!n.id.startsWith(prefix)) continue;
    const rest = n.id.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      visibleOf.set(n.id, n.id);
      visible.push({ ...n, folder });
      files.push(n);
      continue;
    }
    const sub = prefix + rest.slice(0, slash);
    const id = galaxyId(sub);
    visibleOf.set(n.id, id);
    if (galaxies.has(id)) {
      galaxies.get(id).count++;
      continue;
    }
    const galaxy = { id, type: 'galaxy', label: nameOf(sub), folder: sub, count: 1 };
    if (n.group !== undefined) galaxy.group = -1;
    galaxies.set(id, galaxy);
    visible.push(galaxy);
  }

  const sun = folderSun(folder, files);
  const seen = new Set();
  const merged = [];
  const degree = new Map();
  for (const { source, target } of links) {
    const a = visibleOf.get(source);
    const b = visibleOf.get(target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ source: a, target: b });
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  return {
    nodes: visible.map((n) => {
      const d = degree.get(n.id) ?? 0;
      if (n.type === 'galaxy') return { ...n, degree: d, radius: galaxyRadius(n.count), anchor: sun };
      if (n.folder === null) return { ...n, degree: d, radius: nodeRadius(d), anchor: null };
      if (n.id === sun) return { ...n, type: 'sun', kind: n.type, degree: d, radius: sunRadius(d), anchor: null };
      return { ...n, degree: d, radius: nodeRadius(d), anchor: sun };
    }),
    links: merged,
  };
}

module.exports = { galaxyLayout, folderSun, galaxyId, isGalaxyId, parentFolder };
