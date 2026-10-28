import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { placeNewNodes, nodeRadius } from '../shared/graph-model';
import { orbitalNudge, systemPull, orbitRadius } from '../shared/graph-physics';

// Force simulation off the UI thread. Receives the graph, sends node
// positions as a Float32Array [x0, y0, x1, y1, …] in the order the nodes were given.
//
// in:  { type: 'graph', gen, nodes: [{ id, degree, type?, radius?, anchor? }], links: [{ source, target }] }
//      (galaxy view: `anchor` is the sun a node orbits)
//      { type: 'drag', id, x, y } / { type: 'release', id }
//      { type: 'forces', forces: { center, repel, link, distance, gravity, spin } }
//      { type: 'pause' } / { type: 'resume' } (hidden tab: no work)
// out: { type: 'tick', gen, positions } / { type: 'end', gen }

let gen = 0;
let nodes = [];
let byId = new Map();
// "Gravity": the layout never fully settles; it keeps a little energy and slowly orbits the center.
const LIVE_ALPHA = 0.08;
let gravity = false;
let spin = 1;
let paused = false;
let dragging = false;
let tick = 0;
let repel = 90;
let linkStrength = 0.6;
let linkDistance = 40;
let center = 0.04;
// Galaxies and suns are heavier: they push the rest farther away, so galaxies with no link between
// them stay apart.
const MASS = { galaxy: 6, sun: 2 };

function orbitForce() {
  let list = [];
  // Planets always keep to their sun's orbit (they only circle it with gravity on); the rest
  // circles the center of the graph.
  const force = () => {
    if (gravity) tick++;
    for (const n of list) {
      if (n.fx != null) continue;
      const sun = n.anchor ? byId.get(n.anchor) : null;
      let v;
      if (sun) v = systemPull(n.x - sun.x, n.y - sun.y, n.rest, { spin: gravity ? spin : 0 });
      else if (gravity) v = orbitalNudge(n.x, n.y, { spin, wander: 1, t: tick, phase: n.phase });
      else continue;
      n.vx += v.vx;
      n.vy += v.vy;
    }
  };
  force.initialize = (next) => {
    list = next;
    list.forEach((n, i) => {
      n.phase ??= i * 2.399963;
    });
  };
  return force;
}

const restingTarget = () => (gravity ? LIVE_ALPHA : 0);

const sim = forceSimulation([])
  .force('charge', forceManyBody().strength((n) => -repel * (MASS[n.type] ?? 1)).distanceMax(500))
  // Big bodies sit farther apart. A planet's link to its own sun is loose (the orbit keeps them
  // together).
  .force('link', forceLink([]).id((n) => n.id)
    .distance((l) => linkDistance + Math.max(0, l.source.r - 8) + Math.max(0, l.target.r - 8))
    .strength((l) => (l.source.anchor === l.target.id || l.target.anchor === l.source.id ? linkStrength * 0.1 : linkStrength)))
  // Planets follow their sun, not the center.
  .force('x', forceX(0).strength((n) => (n.anchor ? 0 : center)))
  .force('y', forceY(0).strength((n) => (n.anchor ? 0 : center)))
  .force('collide', forceCollide((n) => n.r + 2))
  .force('orbit', orbitForce())
  .alphaDecay(0.025)
  .stop();

function post() {
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((n, i) => {
    positions[i * 2] = n.x;
    positions[i * 2 + 1] = n.y;
  });
  self.postMessage({ type: 'tick', gen, positions }, [positions.buffer]);
}

sim.on('tick', post);
sim.on('end', () => self.postMessage({ type: 'end', gen }));

// Nodes already on screen keep their place (and speed); only new ones are placed, so editing a
// link nudges the graph instead of re-shuffling it.
function setGraph(next, links) {
  const known = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const old = byId;
  const placed = placeNewNodes(next, links, known);
  nodes = placed.map((p, i) => {
    const prev = old.get(p.id);
    const data = next[i];
    return {
      id: p.id, type: data.type, anchor: data.anchor ?? null, x: p.x, y: p.y, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0, fx: prev?.fx, fy: prev?.fy,
      r: data.radius ?? nodeRadius(data.degree), phase: prev?.phase,
    };
  });
  byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const sun = n.anchor ? byId.get(n.anchor) : null;
    if (n.anchor && !sun) n.anchor = null;
    // Galaxies circle the sun on wider orbits than single files.
    if (sun) n.rest = orbitRadius(sun.r, n.r, n.id);
  }
  sim.nodes(nodes);
  sim.force('link').links(links.map((l) => ({ source: l.source, target: l.target })));
  sim.force('collide').initialize(nodes);
  sim.force('orbit').initialize(nodes);
  sim.alpha(known.size ? 0.3 : 1).alphaTarget(dragging ? 0.3 : restingTarget());
  if (!paused) sim.restart();
  post();
}

// Strength sliders: { center, repel, link, distance } and the gravity switch and spin speed.
function setForces(f) {
  repel = f.repel;
  linkStrength = f.link;
  linkDistance = f.distance;
  center = f.center;
  // Re-setting the accessors makes d3 read the new values.
  const link = sim.force('link');
  link.strength(link.strength()).distance(link.distance());
  sim.force('charge').strength(sim.force('charge').strength());
  sim.force('x').strength(sim.force('x').strength());
  sim.force('y').strength(sim.force('y').strength());
  gravity = Boolean(f.gravity);
  spin = Number.isFinite(f.spin) ? Math.max(0, Math.min(3, f.spin)) : 1;
  if (!dragging) sim.alphaTarget(restingTarget());
  if (nodes.length && !paused) sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
}

self.onmessage = ({ data }) => {
  if (data.type === 'forces') {
    setForces(data.forces);
  } else if (data.type === 'graph') {
    gen = data.gen;
    setGraph(data.nodes, data.links);
  } else if (data.type === 'drag') {
    const n = byId.get(data.id);
    if (!n) return;
    n.fx = data.x;
    n.fy = data.y;
    dragging = true;
    sim.alphaTarget(0.3).restart();
  } else if (data.type === 'release') {
    const n = byId.get(data.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    dragging = false;
    sim.alphaTarget(restingTarget());
  } else if (data.type === 'pause') {
    paused = true;
    sim.stop();
  } else if (data.type === 'resume') {
    paused = false;
    if (nodes.length && (gravity || sim.alpha() > sim.alphaMin())) sim.restart();
  }
};
