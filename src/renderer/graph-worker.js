import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { placeNewNodes, nodeRadius } from '../shared/graph-model';

// Force simulation off the UI thread, like Obsidian's sim.js. Receives the graph, sends node
// positions as a Float32Array [x0, y0, x1, y1, …] in the order the nodes were given.
//
// in:  { type: 'graph', gen, nodes: [{ id, degree }], links: [{ source, target }] }
//      { type: 'drag', id, x, y } / { type: 'release', id }
// out: { type: 'tick', gen, positions } / { type: 'end', gen }

let gen = 0;
let nodes = [];
let byId = new Map();

const sim = forceSimulation([])
  .force('charge', forceManyBody().strength(-90).distanceMax(500))
  .force('link', forceLink([]).id((n) => n.id).distance(40).strength(0.6))
  .force('x', forceX(0).strength(0.04))
  .force('y', forceY(0).strength(0.04))
  .force('collide', forceCollide((n) => n.r + 2))
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
    return { id: p.id, x: p.x, y: p.y, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0, fx: prev?.fx, fy: prev?.fy, r: nodeRadius(next[i].degree) };
  });
  byId = new Map(nodes.map((n) => [n.id, n]));
  sim.nodes(nodes);
  sim.force('link').links(links.map((l) => ({ source: l.source, target: l.target })));
  sim.force('collide').initialize(nodes);
  sim.alpha(known.size ? 0.3 : 1).restart();
  post();
}

self.onmessage = ({ data }) => {
  if (data.type === 'graph') {
    gen = data.gen;
    setGraph(data.nodes, data.links);
  } else if (data.type === 'drag') {
    const n = byId.get(data.id);
    if (!n) return;
    n.fx = data.x;
    n.fy = data.y;
    sim.alphaTarget(0.3).restart();
  } else if (data.type === 'release') {
    const n = byId.get(data.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    sim.alphaTarget(0);
  }
};
