'use strict';

// Background traffic for the constellation sky: small ASCII ships, chases, fleets and asteroids
// crossing the screen now and then. Purely decorative, nobody controls it. Few things at once,
// faint and far away, so it never competes with the notes. Pure logic (no canvas): the graph view
// steps it every frame and draws the glyphs it returns.

// Sprites face right; the ones going left are mirrored (see mirror()).
const SPRITES = {
  fighter: [
    ' \\',
    '-=>',
    ' /',
  ],
  interceptor: ['|-o-|'],
  dart: ['=>'],
  cruiser: [
    '|``--.._',
    '|==[]  _>',
    '|__..--\'',
  ],
  rocks: [['@'], ['o'], ['°'], ['.-.', '\'-\'']],
};

const MIRROR = { '<': '>', '>': '<', '/': '\\', '\\': '/', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };

// Flips a sprite left-right. Lines are padded first so the columns stay aligned.
function mirror(lines) {
  const width = Math.max(...lines.map((l) => l.length));
  return lines.map((l) => [...l.padEnd(width)].reverse().map((c) => MIRROR[c] ?? c).join('').replace(/\s+$/, ''));
}

const spriteWidth = (lines) => Math.max(...lines.map((l) => l.length));

const TRAFFIC = {
  maxEvents: 2,
  firstGap: [2, 6],
  gap: [6, 16],
  // How often each kind of crossing shows up.
  kinds: [['asteroids', 0.34], ['lone', 0.24], ['chase', 0.26], ['fleet', 0.16]],
  // Character cell in px for a font size of 1 (monospace).
  cellW: 0.62,
  cellH: 1.15,
};

// Small, fast seeded generator (mulberry32), as in graph-physics.js.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand, [lo, hi]) => lo + rand() * (hi - lo);
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

function pickKind(rand) {
  let r = rand() * TRAFFIC.kinds.reduce((sum, [, w]) => sum + w, 0);
  for (const [kind, w] of TRAFFIC.kinds) {
    r -= w;
    if (r < 0) return kind;
  }
  return TRAFFIC.kinds[0][0];
}

function createTraffic(seed = Date.now()) {
  const rand = random(seed);
  return { rand, time: 0, events: [], bolts: [], nextSpawn: between(rand, TRAFFIC.firstGap) };
}

// A piece is one sprite placed at (dx, dy) character cells from the event's anchor. `wobble`
// makes it drift up and down a little (ships in a chase dodging).
const piece = (lines, dx, dy, extra = {}) => ({ lines, dx, dy, wobble: 0, phase: 0, ...extra });

// Builds the pieces of one crossing, all facing right (the anchor is the front of the group).
function buildPieces(kind, rand) {
  if (kind === 'asteroids') {
    const pieces = [];
    const count = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      pieces.push(piece(pick(rand, SPRITES.rocks), -i * between(rand, [4, 9]), between(rand, [-3, 3])));
    }
    return { pieces, speed: [10, 24], slope: 0.25, gun: false };
  }
  if (kind === 'lone') {
    const sprite = pick(rand, [SPRITES.fighter, SPRITES.interceptor, SPRITES.dart]);
    const pieces = [piece(sprite, 0, 0)];
    // Sometimes a wingman.
    if (rand() < 0.35) pieces.push(piece(sprite, -5, sprite.length + 1));
    return { pieces, speed: [110, 170], slope: 0.05, gun: false };
  }
  if (kind === 'chase') {
    // One ship running, one to three hunting it, wobbling and firing now and then.
    const pieces = [piece(pick(rand, [SPRITES.fighter, SPRITES.dart]), 0, 0, { wobble: 0.6, phase: rand() * 6 })];
    const hunters = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < hunters; i++) {
      pieces.push(piece(SPRITES.interceptor, -12 - i * 8, between(rand, [-2, 2]), { wobble: 0.8, phase: rand() * 6, gun: true }));
    }
    return { pieces, speed: [120, 180], slope: 0.04, gun: true };
  }
  // A fleet: one or two cruisers and a V of escorts behind.
  const pieces = [piece(SPRITES.cruiser, 0, 0)];
  if (rand() < 0.4) pieces.push(piece(SPRITES.cruiser, -16, 5));
  const escorts = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < escorts; i++) {
    const row = Math.floor(i / 2) + 1;
    const side = i % 2 ? 1 : -1;
    pieces.push(piece(SPRITES.dart, -6 - row * 5, 1 + side * (row * 2 + 2)));
  }
  return { pieces, speed: [22, 38], slope: 0.02, gun: false };
}

// Width and height of the group, in cells, measured from the anchor.
function extent(pieces) {
  let left = 0;
  let right = 0;
  for (const p of pieces) {
    left = Math.min(left, p.dx);
    right = Math.max(right, p.dx + spriteWidth(p.lines));
  }
  return { left, right };
}

function spawn(state, width, height, kind = pickKind(state.rand)) {
  const { rand } = state;
  const built = buildPieces(kind, rand);
  // Depth: farther things are smaller, fainter and slower.
  const depth = between(rand, [0.45, 1]);
  const size = Math.round(8 + depth * 5);
  const cw = size * TRAFFIC.cellW;
  const dir = rand() < 0.5 ? 1 : -1;
  const box = extent(built.pieces);
  const pieces = dir > 0 ? built.pieces : built.pieces.map((p) => {
    // Mirrored around the anchor: offsets flip and the sprite is drawn from its other end.
    const lines = mirror(p.lines);
    return { ...p, lines, dx: -p.dx - spriteWidth(lines) };
  });
  const speed = between(rand, built.speed) * (0.6 + depth * 0.4);
  // Starts just outside the side it comes from (the whole group, trailing ships too).
  const x = dir > 0 ? -box.right * cw - 4 : width + box.right * cw + 4;
  const y = between(rand, [0.1, 0.9]) * height;
  const event = {
    kind,
    dir,
    x,
    y,
    vx: dir * speed,
    vy: (rand() * 2 - 1) * built.slope * speed,
    size,
    alpha: 0.12 + depth * 0.2,
    gun: built.gun,
    nextShot: between(rand, [0.4, 1.5]),
    span: (box.right - box.left) * cw,
    pieces,
  };
  state.events.push(event);
  return event;
}

const offscreen = (e, width, height) => (e.dir > 0 ? e.x - e.span > width + 8 : e.x + e.span < -8)
  || e.y < -height * 0.3 || e.y > height * 1.3;

const wobbleOf = (p, time) => (p.wobble ? Math.sin(time * 2.2 + p.phase) * p.wobble : 0);

// A short laser streak leaving the front of a hunter, faster than the ships.
function boltFrom(e, p, time) {
  const cw = e.size * TRAFFIC.cellW;
  const ch = e.size * TRAFFIC.cellH;
  const front = e.dir > 0 ? p.dx + spriteWidth(p.lines) + 1 : p.dx - 2;
  return {
    x: e.x + front * cw,
    y: e.y + (p.dy + wobbleOf(p, time)) * ch,
    vx: e.vx * 2.4,
    life: 0.7,
    maxLife: 0.7,
    size: e.size,
    alpha: e.alpha * 1.3,
  };
}

// Advances the traffic by dt seconds on a width × height screen. A long pause (hidden tab) is
// cut short so nothing jumps across the screen.
function stepTraffic(state, dt, width, height) {
  const step = Math.min(Math.max(dt, 0), 0.1);
  state.time += step;
  for (const e of state.events) {
    e.x += e.vx * step;
    e.y += e.vy * step;
    if (e.gun) {
      e.nextShot -= step;
      if (e.nextShot <= 0) {
        e.nextShot = between(state.rand, [0.5, 1.8]);
        const shooter = pick(state.rand, e.pieces.filter((p) => p.gun));
        if (shooter) state.bolts.push(boltFrom(e, shooter, state.time));
      }
    }
  }
  for (const b of state.bolts) {
    b.x += b.vx * step;
    b.life -= step;
  }
  state.bolts = state.bolts.filter((b) => b.life > 0);
  state.events = state.events.filter((e) => !offscreen(e, width, height));
  state.nextSpawn -= step;
  if (state.nextSpawn <= 0) {
    state.nextSpawn = between(state.rand, TRAFFIC.gap);
    if (state.events.length < TRAFFIC.maxEvents && width > 0 && height > 0) spawn(state, width, height);
  }
}

// What to draw now: one entry per sprite line, in screen px (text baseline at y).
function trafficGlyphs(state) {
  const out = [];
  for (const e of state.events) {
    const cw = e.size * TRAFFIC.cellW;
    const ch = e.size * TRAFFIC.cellH;
    for (const p of e.pieces) {
      const dy = p.dy + wobbleOf(p, state.time);
      p.lines.forEach((text, row) => {
        out.push({ text, x: e.x + p.dx * cw, y: e.y + (dy + row) * ch, size: e.size, alpha: e.alpha });
      });
    }
  }
  for (const b of state.bolts) {
    out.push({ text: '--', x: b.x, y: b.y, size: b.size, alpha: b.alpha * (b.life / b.maxLife), bolt: true });
  }
  return out;
}

module.exports = { SPRITES, TRAFFIC, mirror, createTraffic, spawn, stepTraffic, trafficGlyphs };
