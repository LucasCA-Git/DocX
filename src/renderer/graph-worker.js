import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { placeNewNodes, nodeRadius } from '../shared/graph-model';
import { orbitalNudge } from '../shared/graph-physics';

// Force simulation off the UI thread. Receives the graph, sends node
// positions as a Float32Array [x0, y0, x1, y1, …] in the order the nodes were given.
//
// in:  { type: 'graph', gen, nodes: [{ id, degree }], links: [{ source, target }] }
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

function orbitForce() {
  let list = [];
  const force = () => {
    if (!gravity) return;
    tick++;
    for (const n of list) {
      if (n.fx != null) continue;
      const v = orbitalNudge(n.x, n.y, { spin, wander: 1, t: tick, phase: n.phase });
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
  .force('charge', forceManyBody().strength(-90).distanceMax(500))
  .force('link', forceLink([]).id((n) => n.id).distance(40).strength(0.6))
  .force('x', forceX(0).strength(0.04))
  .force('y', forceY(0).strength(0.04))
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
    return { id: p.id, x: p.x, y: p.y, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0, fx: prev?.fx, fy: prev?.fy, r: nodeRadius(next[i].degree), phase: prev?.phase };
  });
  byId = new Map(nodes.map((n) => [n.id, n]));
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
  sim.force('charge').strength(-f.repel);
  sim.force('link').strength(f.link).distance(f.distance);
  sim.force('x').strength(f.center);
  sim.force('y').strength(f.center);
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
