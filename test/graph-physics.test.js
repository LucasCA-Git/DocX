'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { orbitalNudge, makeStarfield, twinkle, ORBIT } = require('../src/shared/graph-physics');

const dot = (a, b) => a.vx * b.x + a.vy * b.y;

test('orbital nudge is tangential to the center (no wander)', () => {
  for (const p of [{ x: 100, y: 0 }, { x: 0, y: -250 }, { x: -70, y: 40 }]) {
    const v = orbitalNudge(p.x, p.y, { spin: 1, wander: 0, t: 0, phase: 0 });
    assert.ok(Math.abs(dot(v, p)) < 1e-9, 'perpendicular to the radius');
    assert.ok(Math.hypot(v.vx, v.vy) > 0);
  }
  // Same sense of rotation everywhere (counter-clockwise on screen: y grows downwards).
  const right = orbitalNudge(100, 0, { spin: 1, wander: 0, t: 0, phase: 0 });
  const top = orbitalNudge(0, -100, { spin: 1, wander: 0, t: 0, phase: 0 });
  assert.ok(right.vy < 0 && top.vx < 0);
});

test('inner nodes turn faster (angular speed falls with distance), like a galaxy', () => {
  const omega = (d) => Math.hypot(...Object.values(orbitalNudge(d, 0, { spin: 1, wander: 0, t: 0, phase: 0 }))) / d;
  assert.ok(omega(30) > omega(300));
  assert.ok(omega(300) > omega(3000));
});

test('spin 0 and the exact center give no orbit; speeds stay small and finite', () => {
  assert.deepEqual(orbitalNudge(100, 50, { spin: 0, wander: 0, t: 0, phase: 0 }), { vx: 0, vy: 0 });
  const c = orbitalNudge(0, 0, { spin: 1, wander: 0, t: 0, phase: 0 });
  assert.ok(Number.isFinite(c.vx) && Number.isFinite(c.vy));
  for (const d of [1, 10, 100, 1000, 10000]) {
    const v = orbitalNudge(d, 0, { spin: 1, wander: 1, t: 123, phase: 4 });
    assert.ok(Math.hypot(v.vx, v.vy) <= ORBIT.maxSpeed + ORBIT.wander + 1e-9, `bounded at ${d}`);
  }
});

test('wander drifts smoothly over time and differs per node', () => {
  const at = (t, phase) => orbitalNudge(0, 0, { spin: 0, wander: 1, t, phase });
  const a = at(100, 1);
  const b = at(101, 1);
  assert.ok(Math.hypot(a.vx - b.vx, a.vy - b.vy) < ORBIT.wander * 0.2, 'smooth');
  assert.notDeepEqual(at(100, 1), at(100, 2));
});

test('starfield is deterministic, inside the unit square and varied', () => {
  const a = makeStarfield(200, 42);
  assert.deepEqual(a, makeStarfield(200, 42));
  assert.notDeepEqual(a, makeStarfield(200, 7));
  assert.equal(a.length, 200);
  for (const s of a) {
    assert.ok(s.x >= 0 && s.x < 1 && s.y >= 0 && s.y < 1);
    assert.ok(s.r > 0 && s.r <= 1.6);
    assert.ok(s.base > 0 && s.base <= 1);
    assert.ok(s.depth > 0 && s.depth <= 1);
  }
  assert.ok(new Set(a.map((s) => s.r.toFixed(2))).size > 10);
});

test('twinkle stays within [0, 1] and changes over time', () => {
  const values = [];
  for (let t = 0; t < 600; t += 7) values.push(twinkle(0.8, 1.3, t));
  assert.ok(values.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.max(...values) - Math.min(...values) > 0.1);
});
