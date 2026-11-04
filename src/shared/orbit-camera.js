'use strict';

// The 3D graph's camera: it orbits a target point. Dragging turns it around the target (yaw and
// pitch), the wheel moves it closer or farther, the right button slides the target across the
// screen. Pure (plain objects in, new objects out): the 3D scene turns it into a three.js camera,
// and the tests check it without WebGL.
//
// orbit: { tx, ty, tz (target), distance, yaw (around the vertical axis), pitch (up/down) }.
// At yaw 0, pitch 0 the camera is on +Z looking at the target, Y up.

const ORBIT_LIMITS = {
  // Just short of straight up/down, so "up" never flips.
  pitch: 1.45,
  minDistance: 5,
  maxDistance: 50000,
  // Radians per pixel dragged.
  rotate: 0.005,
  // Seconds without input before the slow turn starts, and its speed (radians per second).
  idle: 4,
  spin: 0.06,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function createOrbit({ tx = 0, ty = 0, tz = 0, distance = 500, yaw = 0, pitch = 0.35 } = {}) {
  return { tx, ty, tz, distance, yaw, pitch };
}

function orbitPosition(o) {
  const c = Math.cos(o.pitch);
  return {
    x: o.tx + o.distance * c * Math.sin(o.yaw),
    y: o.ty + o.distance * Math.sin(o.pitch),
    z: o.tz + o.distance * c * Math.cos(o.yaw),
  };
}

// Unit vectors of the view: right and up on screen, forward towards the target.
function orbitBasis(o) {
  const cp = Math.cos(o.pitch);
  const sp = Math.sin(o.pitch);
  const forward = { x: -cp * Math.sin(o.yaw), y: -sp, z: -cp * Math.cos(o.yaw) };
  const right = { x: Math.cos(o.yaw), y: 0, z: -Math.sin(o.yaw) };
  // up = right × forward
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  return { right, up, forward };
}

// Dragging by (dx, dy) pixels: the scene follows the pointer.
function rotateOrbit(o, dx, dy) {
  return {
    ...o,
    yaw: o.yaw - dx * ORBIT_LIMITS.rotate,
    pitch: clamp(o.pitch + dy * ORBIT_LIMITS.rotate, -ORBIT_LIMITS.pitch, ORBIT_LIMITS.pitch),
  };
}

// factor > 1 moves closer.
function zoomOrbit(o, factor) {
  return { ...o, distance: clamp(o.distance / factor, ORBIT_LIMITS.minDistance, ORBIT_LIMITS.maxDistance) };
}

// Slides the target so the point under the pointer follows it (at the target's depth).
// viewHeight in pixels, fov: vertical field of view in degrees.
function panOrbit(o, dx, dy, viewHeight, fov) {
  const perPixel = (2 * o.distance * Math.tan((fov * Math.PI) / 360)) / Math.max(1, viewHeight);
  const { right, up } = orbitBasis(o);
  return {
    ...o,
    tx: o.tx - right.x * dx * perPixel + up.x * dy * perPixel,
    ty: o.ty - right.y * dx * perPixel + up.y * dy * perPixel,
    tz: o.tz - right.z * dx * perPixel + up.z * dy * perPixel,
  };
}

// Frames a sphere { x, y, z, radius } (the whole graph) from the current angle. aspect = width / height.
function fitOrbit(o, sphere, fov, aspect) {
  const v = (fov * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  const half = Math.min(v, h) / 2;
  const distance = clamp((Math.max(0, sphere.radius) / Math.sin(half)) * 1.05, ORBIT_LIMITS.minDistance, ORBIT_LIMITS.maxDistance);
  return { ...o, tx: sphere.x, ty: sphere.y, tz: sphere.z, distance };
}

// Close to a point (a node of radius r), keeping the angle.
function focusOrbit(o, point, r) {
  const distance = clamp(Math.max(r * 10, 80), ORBIT_LIMITS.minDistance, ORBIT_LIMITS.maxDistance);
  return { ...o, tx: point.x, ty: point.y, tz: point.z, distance: Math.min(distance, o.distance) };
}

// Where a flight from `from` to `to` is at t (0…1), eased in and out; the yaw turns the short way.
function flyOrbit(from, to, t) {
  if (t <= 0) return { ...from };
  const e = t >= 1 ? 1 : t * t * (3 - 2 * t);
  const lerp = (a, b) => a + (b - a) * e;
  const turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return {
    tx: lerp(from.tx, to.tx),
    ty: lerp(from.ty, to.ty),
    tz: lerp(from.tz, to.tz),
    // Distance eases on a log scale, so long zooms do not rush at the end.
    distance: Math.exp(lerp(Math.log(from.distance), Math.log(to.distance))),
    yaw: from.yaw + turn * e,
    pitch: lerp(from.pitch, to.pitch),
  };
}

// The slow turn when nobody touches the graph: idle and dt in seconds, speed in radians per second.
function autoRotate(o, { idle, dt, speed = ORBIT_LIMITS.spin }) {
  if (idle < ORBIT_LIMITS.idle || speed <= 0) return o;
  return { ...o, yaw: o.yaw + speed * Math.min(Math.max(dt, 0), 0.1) };
}

module.exports = {
  ORBIT_LIMITS, createOrbit, orbitPosition, orbitBasis, rotateOrbit, zoomOrbit, panOrbit, fitOrbit, focusOrbit, flyOrbit, autoRotate,
};
