'use strict';

// "Gravity" for the graph: a slow orbit around the center plus a gentle drift, so the layout keeps
// moving like a small galaxy instead of freezing. Also the starry sky behind the constellation.
// Pure: used by the simulation worker and the graph view, and by the tests.

// Velocity added per simulation tick. With d3's velocity decay (0.4) a constant nudge settles at
// about 1.5x its size, so maxSpeed 0.25 is ~0.4 world units per tick at most.
const ORBIT = { maxSpeed: 0.25, core: 120, wander: 0.06 };

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

module.exports = { ORBIT, orbitalNudge, makeStarfield, twinkle };
