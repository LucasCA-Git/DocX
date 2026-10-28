import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { placeNewNodes, nodeRadius } from '../shared/graph-model';
import { orbitalNudge, systemPull, orbitRadius, fixedOrbitStep } from '../shared/graph-physics';

// Force simulation off the UI thread. Receives the graph, sends node
// positions as a Float32Array [x0, y0, x1, y1, …] in the order the nodes were given.
//
// in:  { type: 'graph', gen, nodes: [{ id, degree, type?, radius?, anchor?, x?, y?, pinned? }], links: [{ source, target }] }
//      (galaxy view: `anchor` is the sun a node orbits; x/y/pinned: where the user left it)
//      { type: 'drag', id, x, y } / { type: 'release', id, pin } / { type: 'unpin-all' }
//      { type: 'forces', forces: { center, repel, link, distance, spacing, gravity, spin } }
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
let spacing = 1;
// Galaxies and suns are heavier: they push the rest farther away, so galaxies with no link between
// them stay apart.
const MASS = { galaxy: 6, sun: 2 };

function orbitForce() {
  let list = [];
  // Planets always keep to their sun's orbit (they only circle it with gravity on). Suns stay
  // still and galaxies only move by their links; loose stars circle the center of the graph.
  const force = () => {
    if (gravity) tick++;
    for (const n of list) {
      if (n.fx != null) continue;
      const sun = n.anchor ? byId.get(n.anchor) : null;
      if (sun && n.fixed) {
        // Pinned planet: on its circle, only turning. Set the velocity so that after d3's decay
        // (x += v * 0.6) it lands exactly on the next spot.
        const step = fixedOrbitStep(n.x - sun.x, n.y - sun.y, n.rest, { spin: gravity ? spin : 0 });
        n.vx = step.dx / (1 - VELOCITY_DECAY);
        n.vy = step.dy / (1 - VELOCITY_DECAY);
        continue;
      }
      let v;
      if (sun) v = systemPull(n.x - sun.x, n.y - sun.y, n.rest, { spin: gravity ? spin : 0 });
      else if (gravity && n.type !== 'galaxy') v = orbitalNudge(n.x, n.y, { spin, wander: 1, t: tick, phase: n.phase });
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

const VELOCITY_DECAY = 0.4;
const restingTarget = () => (gravity ? LIVE_ALPHA : 0);

const sim = forceSimulation([])
  .force('charge', forceManyBody().strength((n) => -repel * spacing * (MASS[n.type] ?? 1)).distanceMax(500))
  // Big bodies sit farther apart. A planet's link to its own sun is loose (the orbit keeps them
  // together).
  .force('link', forceLink([]).id((n) => n.id)
    .distance((l) => (linkDistance + Math.max(0, l.source.r - 8) + Math.max(0, l.target.r - 8)) * spacing)
    .strength((l) => (l.source.anchor === l.target.id || l.target.anchor === l.source.id ? linkStrength * 0.1 : linkStrength)))
  // Planets follow their sun, not the center.
  .force('x', forceX(0).strength((n) => (n.anchor ? 0 : center)))
  .force('y', forceY(0).strength((n) => (n.anchor ? 0 : center)))
  .force('collide', forceCollide((n) => n.r + 2))
  .force('orbit', orbitForce())
  .alphaDecay(0.025)
  .velocityDecay(VELOCITY_DECAY)
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
  // Where the user left the graph last time, for nodes not on screen now.
  for (const n of next) if (!known.has(n.id) && Number.isFinite(n.x) && Number.isFinite(n.y)) known.set(n.id, { x: n.x, y: n.y });
  const restored = new Set(next.filter((n) => Number.isFinite(n.x)).map((n) => n.id));
  const old = byId;
  const placed = placeNewNodes(next, links, known);
  nodes = placed.map((p, i) => {
    const prev = old.get(p.id);
    const data = next[i];
    // A pin is kept only while the node stays the same kind (a sun that turns into a planet lets go).
    const same = prev?.type === data.type ? prev : null;
    return {
      id: p.id, type: data.type, anchor: data.anchor ?? null, x: p.x, y: p.y, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0, fx: same?.fx, fy: same?.fy,
      r: data.radius ?? nodeRadius(data.degree), phase: prev?.phase, fixed: same ? same.fixed : false,
      saved: data.pinned && !prev,
    };
  });
  byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    // The sun is the heaviest body: it holds still (in the middle, or where it was dropped) and
    // its planets go around it.
    if (n.type === 'sun' && n.fx == null) {
      if (!restored.has(n.id)) {
        n.x = 0;
        n.y = 0;
      }
      n.fx = n.x;
      n.fy = n.y;
    }
  }
  for (const n of nodes) {
    const sun = n.anchor ? byId.get(n.anchor) : null;
    if (n.anchor && !sun) n.anchor = null;
    // Pinned last time: a planet keeps its distance to the sun, anything else its place.
    if (n.saved) pin(n);
    delete n.saved;
    if (!n.fixed) n.rest = sun ? orbitRadius(sun.r, n.r, n.id, spacing) : undefined;
  }
  sim.nodes(nodes);
  sim.force('link').links(links.map((l) => ({ source: l.source, target: l.target })));
  sim.force('collide').initialize(nodes);
  sim.force('orbit').initialize(nodes);
  sim.alpha(known.size ? 0.3 : 1).alphaTarget(dragging ? 0.3 : restingTarget());
  if (!paused) sim.restart();
  post();
}

// Pins a node where it is: a planet keeps its distance to its sun (and still turns around it with
// gravity on), anything else stays still.
function pin(n) {
  const sun = n.anchor ? byId.get(n.anchor) : null;
  if (sun) {
    n.fixed = true;
    n.rest = Math.max(1, Math.hypot(n.x - sun.x, n.y - sun.y));
    n.fx = null;
    n.fy = null;
  } else {
    n.fx = n.x;
    n.fy = n.y;
  }
}

function unpin(n) {
  const sun = n.anchor ? byId.get(n.anchor) : null;
  n.fixed = false;
  if (sun) n.rest = orbitRadius(sun.r, n.r, n.id, spacing);
  if (n.type !== 'sun') {
    n.fx = null;
    n.fy = null;
  }
}

// Strength sliders: { center, repel, link, distance } and the gravity switch and spin speed.
function setForces(f) {
  repel = f.repel;
  linkStrength = f.link;
  linkDistance = f.distance;
  center = f.center;
  spacing = Number.isFinite(f.spacing) ? Math.max(0.3, Math.min(4, f.spacing)) : 1;
  for (const n of nodes) {
    const sun = n.anchor ? byId.get(n.anchor) : null;
    if (sun && !n.fixed) n.rest = orbitRadius(sun.r, n.r, n.id, spacing);
  }
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
    // Suns always stay where they are dropped; anything else only when pinning is on.
    if (n && n.type !== 'sun') {
      if (data.pin) {
        n.x = n.fx ?? n.x;
        n.y = n.fy ?? n.y;
        pin(n);
      } else {
        unpin(n);
      }
    }
    dragging = false;
    sim.alphaTarget(restingTarget());
  } else if (data.type === 'unpin-all') {
    nodes.forEach(unpin);
    if (!paused) sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
  } else if (data.type === 'pause') {
    paused = true;
    sim.stop();
  } else if (data.type === 'resume') {
    paused = false;
    if (nodes.length && (gravity || sim.alpha() > sim.alphaMin())) sim.restart();
  }
};
