'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOrbit, orbitPosition, orbitBasis, rotateOrbit, zoomOrbit, panOrbit, fitOrbit, flyOrbit, focusOrbit,
  autoRotate, ORBIT_LIMITS,
} = require('../src/shared/orbit-camera');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

test('the camera sits on a sphere around its target, looking at it', () => {
  const o = createOrbit({ tx: 10, ty: 0, tz: 0, distance: 100, yaw: 0, pitch: 0 });
  assert.deepEqual(orbitPosition(o), { x: 10, y: 0, z: 100 });
  const above = orbitPosition({ ...o, pitch: Math.PI / 4 });
  assert.ok(above.y > 0 && near(Math.hypot(above.x - 10, above.y, above.z), 100));
  // Right, up and forward are orthonormal; forward points at the target.
  const { right, up, forward } = orbitBasis({ ...o, yaw: 0.7, pitch: -0.3 });
  for (const [a, b] of [[right, up], [right, forward], [up, forward]]) assert.ok(near(dot(a, b), 0));
  for (const v of [right, up, forward]) assert.ok(near(Math.hypot(v.x, v.y, v.z), 1));
  const p = orbitPosition({ ...o, yaw: 0.7, pitch: -0.3 });
  const toTarget = sub({ x: 10, y: 0, z: 0 }, p);
  assert.ok(near(dot(toTarget, forward), 100));
});

test('dragging turns the constellation; the camera never flips over the poles', () => {
  const o = createOrbit({ distance: 100 });
  const turned = rotateOrbit(o, 100, 0);
  assert.ok(turned.yaw < o.yaw, 'dragging right turns the scene right');
  assert.equal(turned.distance, 100);
  const top = rotateOrbit(o, 0, 100000);
  assert.ok(near(top.pitch, ORBIT_LIMITS.pitch));
  const bottom = rotateOrbit(o, 0, -100000);
  assert.ok(near(bottom.pitch, -ORBIT_LIMITS.pitch));
  assert.ok(ORBIT_LIMITS.pitch < Math.PI / 2);
});

test('zoom moves closer or farther, within limits', () => {
  const o = createOrbit({ distance: 100 });
  assert.ok(zoomOrbit(o, 2).distance < 100);
  assert.ok(zoomOrbit(o, 0.5).distance > 100);
  assert.equal(zoomOrbit(o, 1e9).distance, ORBIT_LIMITS.minDistance);
  assert.equal(zoomOrbit(o, 1e-9).distance, ORBIT_LIMITS.maxDistance);
});

test('pan slides the target across the screen, not towards it, at the cursor speed', () => {
  const o = createOrbit({ distance: 200, yaw: 0.4, pitch: 0.2 });
  const moved = panOrbit(o, 30, -10, 600, 60);
  const delta = { x: moved.tx - o.tx, y: moved.ty - o.ty, z: moved.tz - o.tz };
  const { forward, right } = orbitBasis(o);
  assert.ok(near(dot(delta, forward), 0));
  // The point under the cursor follows the cursor: dragging right moves the target left.
  assert.ok(dot(delta, right) < 0);
  const perPixel = (2 * 200 * Math.tan(Math.PI / 6)) / 600;
  assert.ok(near(Math.hypot(delta.x, delta.y, delta.z), Math.hypot(30, 10) * perPixel));
  assert.equal(moved.distance, 200);
});

test('fit frames a sphere: the whole graph in view, whatever the window shape', () => {
  const o = createOrbit({ yaw: 1, pitch: 0.3 });
  const wide = fitOrbit(o, { x: 5, y: 6, z: 7, radius: 100 }, 60, 2);
  assert.deepEqual([wide.tx, wide.ty, wide.tz], [5, 6, 7]);
  assert.ok(wide.distance * Math.sin(Math.PI / 6) >= 100);
  const tall = fitOrbit(o, { x: 0, y: 0, z: 0, radius: 100 }, 60, 0.5);
  assert.ok(tall.distance > wide.distance, 'a narrow window needs more room');
  assert.equal(wide.yaw, 1);
  assert.ok(fitOrbit(o, { x: 0, y: 0, z: 0, radius: 0 }, 60, 1).distance >= ORBIT_LIMITS.minDistance);
});

test('flying to a node: eases from the start to the end, turning the short way round', () => {
  const from = createOrbit({ tx: 0, distance: 400, yaw: 3.0 });
  const to = createOrbit({ tx: 100, distance: 50, yaw: -3.0 });
  assert.deepEqual(flyOrbit(from, to, 0), from);
  const end = flyOrbit(from, to, 1);
  assert.ok(near(end.tx, 100) && near(end.distance, 50));
  assert.ok(near(Math.cos(end.yaw), Math.cos(-3)) && near(Math.sin(end.yaw), Math.sin(-3)));
  const mid = flyOrbit(from, to, 0.5);
  // The short way from 3.0 to -3.0 goes through π, not through 0.
  assert.ok(Math.abs(mid.yaw) > 3);
  const focus = focusOrbit(from, { x: 1, y: 2, z: 3 }, 10);
  assert.deepEqual([focus.tx, focus.ty, focus.tz], [1, 2, 3]);
  assert.ok(focus.distance < from.distance && focus.distance >= ORBIT_LIMITS.minDistance);
  assert.equal(focus.yaw, from.yaw);
});

test('auto-rotate turns slowly, only after a few idle seconds', () => {
  const o = createOrbit({ yaw: 0 });
  assert.equal(autoRotate(o, { idle: 1, dt: 1 }).yaw, 0);
  const turned = autoRotate(o, { idle: 10, dt: 1 });
  assert.ok(turned.yaw > 0 && turned.yaw < 0.2);
  assert.equal(autoRotate(o, { idle: 10, dt: 1, speed: 0 }).yaw, 0);
  // A long pause (hidden tab) does not jump.
  assert.ok(autoRotate(o, { idle: 1000, dt: 1000 }).yaw < 0.2);
});
