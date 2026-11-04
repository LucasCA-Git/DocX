'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  orbitalNudge, orbitalNudge3, systemPull3, fixedOrbitStep3, makeStarfield3, ORBIT,
} = require('../src/shared/graph-physics');

const len = (v) => Math.hypot(v.vx ?? v.dx, v.vy ?? v.dy, v.vz ?? v.dz);

test('3D orbit: a turn around the vertical axis, in the horizontal (XZ) plane', () => {
  for (const p of [{ x: 100, y: 30, z: 0 }, { x: 0, y: -80, z: -250 }, { x: -70, y: 0, z: 40 }]) {
    const v = orbitalNudge3(p.x, p.y, p.z, { spin: 1, wander: 0, t: 0, phase: 0 });
    assert.equal(v.vy, 0, 'no vertical push without wander');
    assert.ok(Math.abs(v.vx * p.x + v.vz * p.z) < 1e-9, 'perpendicular to the horizontal radius');
    assert.ok(len(v) > 0);
  }
  // Same speed curve as the flat graph (XZ in 3D is XY in 2D).
  const flat = orbitalNudge(100, 40, { spin: 1, wander: 0, t: 0, phase: 0 });
  const deep = orbitalNudge3(100, 999, 40, { spin: 1, wander: 0, t: 0, phase: 0 });
  assert.ok(Math.abs(flat.vx - deep.vx) < 1e-12 && Math.abs(flat.vy - deep.vz) < 1e-12);
});

test('3D orbit: on the vertical axis nothing turns; wander also drifts up and down, gently', () => {
  const still = orbitalNudge3(0, 200, 0, { spin: 1, wander: 0, t: 0, phase: 0 });
  assert.deepEqual(still, { vx: 0, vy: 0, vz: 0 });
  let moved = 0;
  for (let t = 0; t < 2000; t += 37) {
    const v = orbitalNudge3(10, 10, 10, { spin: 0, wander: 1, t, phase: 1.3 });
    moved = Math.max(moved, Math.abs(v.vy));
    assert.ok(len(v) <= ORBIT.wander + 1e-9);
  }
  assert.ok(moved > 0);
});

test('3D planet: the spring keeps it on its orbit radius, in 3D', () => {
  const inside = systemPull3(20, 0, 0, 60, { spin: 0 });
  assert.ok(inside.vx > 0, 'too close: pushed out');
  const outside = systemPull3(0, 0, 120, 60, { spin: 0 });
  assert.ok(outside.vz < 0, 'too far: pulled in');
  const resting = systemPull3(60, 0, 0, 60, { spin: 0 });
  assert.ok(len(resting) < 1e-9);
  assert.deepEqual(systemPull3(0, 0, 0, 60, { spin: 1 }), { vx: 0, vy: 0, vz: 0 });
});

test('3D planet: turns horizontally around its sun and settles into a flat disc', () => {
  const v = systemPull3(60, 0, 0, 60, { spin: 1 });
  assert.ok(Math.abs(v.vx) < 1e-9 && Math.abs(v.vy) < 1e-9 && Math.abs(v.vz) > 0, 'tangential at rest');
  // Above the disc: a pull back down, besides the spring.
  const above = systemPull3(Math.sqrt(60 ** 2 - 30 ** 2), 30, 0, 60, { spin: 0 });
  assert.ok(above.vy < 0);
});

test('3D pinned planet: keeps its distance and height, a little further round', () => {
  const dx = 40;
  const dy = 20;
  const dz = -30;
  const rest = Math.hypot(dx, dy, dz);
  const step = fixedOrbitStep3(dx, dy, dz, rest, { spin: 1 });
  const nx = dx + step.dx;
  const ny = dy + step.dy;
  const nz = dz + step.dz;
  assert.ok(Math.abs(Math.hypot(nx, ny, nz) - rest) < 1e-6);
  assert.ok(Math.abs(ny - dy) < 1e-6, 'same height');
  assert.ok(Math.hypot(step.dx, step.dz) > 0, 'moved round');
  const frozen = fixedOrbitStep3(dx, dy, dz, rest, { spin: 0 });
  assert.ok(len(frozen) < 1e-9);
  // Dropped on a different radius: lands on the sphere of radius `rest`.
  const pulled = fixedOrbitStep3(10, 0, 0, 50, { spin: 0 });
  assert.ok(Math.abs(10 + pulled.dx - 50) < 1e-9);
});

test('3D starfield: same sky every time, on a shell around the scene', () => {
  const a = makeStarfield3(500, 7);
  const b = makeStarfield3(500, 7);
  assert.deepEqual(a, b);
  assert.equal(a.length, 500);
  for (const s of a) {
    const r = Math.hypot(s.x, s.y, s.z);
    assert.ok(r >= 0.6 - 1e-9 && r <= 1 + 1e-9);
    assert.ok(s.base > 0 && s.base <= 1 && s.size > 0);
  }
  assert.notDeepEqual(makeStarfield3(10, 8), makeStarfield3(10, 7));
});
