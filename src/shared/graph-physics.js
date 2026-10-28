'use strict';

// "Gravity" for the graph: a slow orbit around the center plus a gentle drift, so the layout keeps
// moving like a small galaxy instead of freezing. Also the starry sky behind the constellation.
// Pure: used by the simulation worker and the graph view, and by the tests.

// Velocity added per simulation tick. With d3's velocity decay (0.4) a constant nudge settles at
// about 1.5x its size, so maxSpeed 0.25 is ~0.4 world units per tick at most.
const ORBIT = { maxSpeed: 0.25, core: 120, wander: 0.06, planetSpeed: 0.45, pull: 0.08 };

// Tangential nudge around (0, 0) with a galaxy-like rotation curve: speed grows near the core and
// flattens farther out, so inner nodes turn faster. Counter-clockwise on screen (y points down).
// Plus a smooth per-node drift (`phase` makes each node different, `t` is the tick count).
function orbitalNudge(x, y, { spin, wander, t, phase }) {
  let vx = 0;
  let vy = 0;
  const d = Math.hypot(x, y);
  if (spin > 0 && d > 1e-6) {
    const speed = Math.min(ORBIT.maxSpeed, ORBIT.maxSpeed * spin * (d / (d + ORBIT.core)));
    vx += (y / d) * speed;
    vy += (-x / d) * speed;
  }
  if (wander > 0) {
    const w = ORBIT.wander * Math.min(1, wander) * Math.SQRT1_2;
    vx += w * Math.sin(t * 0.011 + phase) * Math.cos(t * 0.004 + phase * 1.7);
    vy += w * Math.cos(t * 0.009 + phase * 1.3) * Math.sin(t * 0.005 + phase * 0.6 + 1);
  }
  return { vx, vy };
}

// A planet at (dx, dy) from its sun: a spring back to its orbit radius `rest` plus a tangential push
// (same turning direction as orbitalNudge) that is faster on inner orbits, like Kepler's planets.
function systemPull(dx, dy, rest, { spin }) {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { vx: 0, vy: 0 };
  const ux = dx / d;
  const uy = dy / d;
  const radial = (rest - d) * ORBIT.pull;
  const speed = spin > 0 ? Math.min(ORBIT.planetSpeed, ORBIT.planetSpeed * spin * 0.5 * Math.sqrt(60 / Math.max(d, 30))) : 0;
  return { vx: ux * radial + uy * speed, vy: uy * radial - ux * speed };
}

// Orbit radius of a planet around its sun: clear of both bodies, on one of a few rings picked from
// the id (stable between updates), so a crowded system spreads out instead of piling up.
function orbitRadius(sunR, planetR, id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return sunR + planetR + 16 + (h % 5) * 11;
}

// Small, fast seeded generator (mulberry32): the same sky every time.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Background stars in the unit square: size, brightness, depth (parallax) and twinkle phase.
function makeStarfield(count, seed = 1) {
  const rand = random(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.08;
    stars.push({
      x: rand(),
      y: rand(),
      r: big ? 0.9 + rand() * 0.7 : 0.3 + rand() * 0.6,
      base: 0.2 + rand() * 0.8,
      depth: 0.1 + rand() * 0.9,
      phase: rand() * Math.PI * 2,
    });
  }
  return stars;
}

// Brightness of a twinkling star at time t (seconds × 60, i.e. frames).
function twinkle(base, phase, t) {
  const v = base * (0.7 + 0.3 * Math.sin(t * 0.045 + phase) * Math.sin(t * 0.017 + phase * 2));
  return Math.min(1, Math.max(0, v));
}

module.exports = { ORBIT, orbitalNudge, systemPull, orbitRadius, makeStarfield, twinkle };
