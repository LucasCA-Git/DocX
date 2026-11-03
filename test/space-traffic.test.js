'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SPRITES, TRAFFIC, mirror, createTraffic, spawn, stepTraffic, trafficGlyphs,
} = require('../src/shared/space-traffic');

const W = 1200;
const H = 800;

test('mirror flips sprites left-right and keeps the columns aligned', () => {
  assert.deepEqual(mirror(['=>']), ['<=']);
  assert.deepEqual(mirror(SPRITES.fighter), [' /', '<=-', ' \\']);
  assert.deepEqual(mirror(SPRITES.interceptor), ['|-o-|'], 'symmetric sprites stay the same');
  const back = mirror(mirror(SPRITES.cruiser));
  assert.deepEqual(back, SPRITES.cruiser.map((l) => l.replace(/\s+$/, '')));
});

test('the same seed gives the same traffic', () => {
  const run = () => {
    const s = createTraffic(42);
    for (let i = 0; i < 600; i++) stepTraffic(s, 1 / 60, W, H);
    return JSON.stringify(trafficGlyphs(s));
  };
  assert.equal(run(), run());
});

test('things start off screen on the side they come from and cross it', () => {
  for (const kind of ['asteroids', 'lone', 'chase', 'fleet']) {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createTraffic(seed);
      const e = spawn(s, W, H, kind);
      for (const g of trafficGlyphs(s)) {
        if (e.dir > 0) assert.ok(g.x + g.text.length * g.size * TRAFFIC.cellW <= 0, `${kind} enters from the left`);
        else assert.ok(g.x >= W, `${kind} enters from the right`);
      }
      assert.equal(Math.sign(e.vx), e.dir);
    }
  }
});

test('a crossing leaves the screen and is dropped', () => {
  const s = createTraffic(7);
  s.nextSpawn = Infinity;
  spawn(s, W, H, 'lone');
  for (let i = 0; i < 60 * 60 && s.events.length; i++) stepTraffic(s, 1 / 60, W, H);
  assert.equal(s.events.length, 0);
});

test('the sky stays clean: few crossings at once, faint glyphs', () => {
  const s = createTraffic(3);
  let most = 0;
  let seen = 0;
  for (let i = 0; i < 60 * 600; i++) {
    stepTraffic(s, 1 / 60, W, H);
    most = Math.max(most, s.events.length);
    for (const g of trafficGlyphs(s)) {
      seen++;
      assert.ok(g.alpha > 0 && g.alpha <= 0.45);
    }
  }
  assert.ok(most <= TRAFFIC.maxEvents);
  assert.ok(seen > 0, 'something did cross in ten minutes');
});

test('chases fire short-lived bolts in the direction of travel', () => {
  const s = createTraffic(11);
  s.nextSpawn = Infinity;
  const e = spawn(s, W, H, 'chase');
  let fired = 0;
  for (let i = 0; i < 60 * 5; i++) {
    stepTraffic(s, 1 / 60, W, H);
    for (const b of s.bolts) {
      fired++;
      assert.equal(Math.sign(b.vx), e.dir);
      assert.ok(b.life > 0 && b.life <= b.maxLife);
    }
  }
  assert.ok(fired > 0);
});

test('a long pause does not make things jump across the screen', () => {
  const s = createTraffic(5);
  s.nextSpawn = Infinity;
  const e = spawn(s, W, H, 'lone');
  const x = e.x;
  stepTraffic(s, 30, W, H);
  assert.ok(Math.abs(e.x - x) <= Math.abs(e.vx) * 0.1 + 1e-9);
});
