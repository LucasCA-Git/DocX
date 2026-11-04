'use strict';

// Background traffic for the constellation sky: small ASCII ships, chases, fleets, battles,
// hyperspace jumps and asteroids crossing the screen. Purely decorative, nobody controls it.
// The level (1 calm … 5 all-out war) sets how much happens at once; at level 1 it is a few faint
// things now and then, so it never competes with the notes. Pure logic (no canvas): the graph
// view steps it every frame and draws the glyphs it returns.

// Sprites face right; the ones going left are mirrored (see mirror()). Two sides: the rebels
// (red lasers) and the empire (green lasers).
const SPRITES = {
  fighter: [
    ' \\',
    '-=>',
    ' /',
  ],
  wing: [
    ' \\\\',
    '-=[]>',
    ' //',
  ],
  bomber: ['=o==-'],
  dart: ['=>'],
  freighter: [
    '  .--.',
    '=(=[]O)',
    '  \'--\'',
  ],
  cruiser: [
    '|``--.._',
    '|==[]  _>',
    '|__..--\'',
  ],
  interceptor: ['|-o-|'],
  hunter: ['>-o-<'],
  destroyer: [
    '  |__..--``',
    '=[|]========>',
    '  |``\'\'--..',
  ],
  rocks: [['@'], ['o'], ['\u00b0'], ['.-.', '\'-\'']],
  explosion: [['*'], ['\\|/', '-o-', '/|\\'], ['. \' .', '\' . \'']],
};

const MIRROR = { '<': '>', '>': '<', '/': '\\', '\\': '/', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };

// Flips a sprite left-right. Lines are padded first so the columns stay aligned.
function mirror(lines) {
  const width = Math.max(...lines.map((l) => l.length));
  return lines.map((l) => [...l.padEnd(width)].reverse().map((c) => MIRROR[c] ?? c).join('').replace(/\s+$/, ''));
}

const spriteWidth = (lines) => Math.max(...lines.map((l) => l.length));

const LASER = { rebel: '#ff6b6b', empire: '#7dff8a' };
const EXPLOSION_COLOR = '#ffd27a';

// Per level: crossings on screen at most, seconds between them, and how often each kind shows up.
const LEVELS = [
  { max: 2, gap: [6, 16], kinds: { asteroids: 0.34, lone: 0.24, chase: 0.26, fleet: 0.16 } },
  { max: 3, gap: [4, 10], kinds: { asteroids: 0.28, lone: 0.18, chase: 0.24, fleet: 0.15, jump: 0.1, battle: 0.05 } },
  { max: 5, gap: [2.5, 7], kinds: { asteroids: 0.18, field: 0.1, lone: 0.12, chase: 0.22, fleet: 0.14, jump: 0.1, battle: 0.14 } },
  { max: 7, gap: [1.5, 4.5], kinds: { asteroids: 0.12, field: 0.1, lone: 0.08, chase: 0.2, fleet: 0.15, jump: 0.1, battle: 0.25 } },
  { max: 10, gap: [0.8, 2.5], kinds: { asteroids: 0.08, field: 0.1, lone: 0.04, chase: 0.18, fleet: 0.15, jump: 0.1, battle: 0.35 } },
];

const TRAFFIC = {
  levels: LEVELS.length,
  firstGap: [2, 6],
  // Chance that a shot in a battle takes down a ship of the other side.
  hitChance: 0.18,
  // Character cell in px for a font size of 1 (monospace).
  cellW: 0.62,
  cellH: 1.15,
};

const levelOf = (level) => LEVELS[Math.min(LEVELS.length, Math.max(1, Math.round(level) || 1)) - 1];

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

function pickKind(rand, kinds) {
  const entries = Object.entries(kinds);
  let r = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [kind, w] of entries) {
    r -= w;
    if (r < 0) return kind;
  }
  return entries[0][0];
}

function createTraffic(seed = Date.now()) {
  const rand = random(seed);
  return {
    rand, time: 0, seq: 0, events: [], bolts: [], blasts: [], nextSpawn: between(rand, TRAFFIC.firstGap),
  };
}

// A piece is one sprite placed at (dx, dy) character cells from the event's anchor. `wobble`
// makes it drift up and down a little (ships dodging), `gun` lets it fire, `armor` keeps it from
// being shot down (big ships), `fade` dims it (hyperspace streaks).
const piece = (lines, dx, dy, extra = {}) => ({
  lines, dx, dy, wobble: 0, phase: 0, gun: false, armor: false, fade: 1, ...extra,
});

const rebelFighter = (rand) => pick(rand, [SPRITES.wing, SPRITES.wing, SPRITES.fighter, SPRITES.bomber]);
const empireFighter = (rand) => pick(rand, [SPRITES.interceptor, SPRITES.interceptor, SPRITES.hunter]);

// A loose squadron of fighters, staggered behind the anchor.
function squadron(rand, count, make, extra) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    pieces.push(piece(make(rand), -i * between(rand, [6, 11]), between(rand, [-5, 5]), {
      wobble: 0.5 + rand() * 0.5, phase: rand() * 6, gun: true, ...extra,
    }));
  }
  return pieces;
}

// Builds the pieces of one crossing, all facing right (the anchor is the front of the group).
function buildPieces(kind, rand) {
  if (kind === 'asteroids' || kind === 'field') {
    // A few rocks, or a whole field of them, tumbling slowly.
    const field = kind === 'field';
    const pieces = [];
    const count = field ? 8 + Math.floor(rand() * 8) : 1 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const dx = field ? -rand() * 70 : -i * between(rand, [4, 9]);
      pieces.push(piece(pick(rand, SPRITES.rocks), dx, between(rand, field ? [-9, 9] : [-3, 3])));
    }
    return { pieces, speed: field ? [8, 16] : [10, 24], slope: field ? 0.1 : 0.25 };
  }
  if (kind === 'lone') {
    const sprite = pick(rand, [SPRITES.fighter, SPRITES.wing, SPRITES.interceptor, SPRITES.dart, SPRITES.freighter]);
    const pieces = [piece(sprite, 0, 0)];
    // Sometimes a wingman.
    if (sprite !== SPRITES.freighter && rand() < 0.35) pieces.push(piece(sprite, -5, sprite.length + 1));
    return { pieces, speed: sprite === SPRITES.freighter ? [70, 110] : [110, 170], slope: 0.05 };
  }
  if (kind === 'jump') {
    // Out of hyperspace and gone: a ship trailing a long streak, very fast.
    const sprite = pick(rand, [SPRITES.freighter, SPRITES.wing, SPRITES.cruiser]);
    const row = Math.floor(sprite.length / 2);
    const streak = '-'.repeat(18 + Math.floor(rand() * 20));
    return {
      pieces: [piece(sprite, 0, 0), piece([`${streak} `], -streak.length - 1, row, { fade: 0.45 })],
      speed: [650, 900],
      slope: 0,
    };
  }
  if (kind === 'chase') {
    // One ship running, one to three hunters after it, wobbling and firing green bolts.
    const pieces = [piece(pick(rand, [SPRITES.fighter, SPRITES.wing, SPRITES.freighter]), 0, 0, { wobble: 0.6, phase: rand() * 6 })];
    const hunters = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < hunters; i++) {
      pieces.push(piece(empireFighter(rand), -12 - i * 8, between(rand, [-2, 2]), { wobble: 0.8, phase: rand() * 6, gun: true }));
    }
    return {
      pieces, speed: [120, 180], slope: 0.04, faction: 'empire',
    };
  }
  // A fleet: a rebel cruiser with fighters, or an imperial destroyer with its escort, in a V.
  const empire = rand() < 0.5;
  const pieces = [piece(empire ? SPRITES.destroyer : SPRITES.cruiser, 0, 0, { armor: true })];
  if (rand() < 0.4) pieces.push(piece(empire ? SPRITES.destroyer : SPRITES.cruiser, -18, 6, { armor: true }));
  const escorts = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < escorts; i++) {
    const row = Math.floor(i / 2) + 1;
    const side = i % 2 ? 1 : -1;
    pieces.push(piece(empire ? empireFighter(rand) : pick(rand, [SPRITES.wing, SPRITES.dart]), -6 - row * 6, 1 + side * (row * 2 + 2)));
  }
  return {
    pieces, speed: [22, 38], slope: 0.02, faction: empire ? 'empire' : 'rebel',
  };
}

// Leftmost and rightmost cell of the group, measured from the anchor.
function extent(pieces) {
  let left = 0;
  let right = 0;
  for (const p of pieces) {
    left = Math.min(left, p.dx);
    right = Math.max(right, p.dx + spriteWidth(p.lines));
  }
  return { left, right };
}

// Puts a group on screen: just outside the side it comes from, heading across.
function launch(state, built, { width, height, dir, y, depth, kind }) {
  const { rand } = state;
  const size = Math.round(8 + depth * 5);
  const cw = size * TRAFFIC.cellW;
  const box = extent(built.pieces);
  const pieces = dir > 0 ? built.pieces : built.pieces.map((p) => {
    // Mirrored around the anchor: offsets flip and the sprite is drawn from its other end.
    const lines = mirror(p.lines);
    return { ...p, lines, dx: -p.dx - spriteWidth(lines) };
  });
  const speed = between(rand, built.speed) * (0.6 + depth * 0.4);
  const event = {
    id: ++state.seq,
    kind,
    dir,
    depth,
    x: dir > 0 ? -box.right * cw - 4 : width + box.right * cw + 4,
    y,
    vx: dir * speed,
    vy: (rand() * 2 - 1) * built.slope * speed,
    size,
    alpha: 0.12 + depth * 0.2,
    faction: built.faction ?? null,
    foe: null,
    nextShot: between(rand, [0.4, 1.5]),
    span: (box.right - box.left) * cw,
    pieces,
  };
  state.events.push(event);
  return event;
}

// A battle: a rebel squadron and an imperial one fly at each other and trade fire; some ships
// blow up on the way. Two events, each the other's foe.
function battle(state, width, height) {
  const { rand } = state;
  const depth = between(rand, [0.6, 1]);
  const y = between(rand, [0.2, 0.8]) * height;
  const dir = rand() < 0.5 ? 1 : -1;
  const rebels = squadron(rand, 2 + Math.floor(rand() * 3), rebelFighter);
  if (rand() < 0.3) rebels.push(piece(SPRITES.cruiser, -30, 7, { armor: true }));
  const empire = squadron(rand, 2 + Math.floor(rand() * 4), empireFighter);
  if (rand() < 0.35) empire.push(piece(SPRITES.destroyer, -34, -8, { armor: true }));
  const a = launch(state, {
    pieces: rebels, speed: [70, 110], slope: 0.02, faction: 'rebel',
  }, {
    width, height, dir, y: y + 4, depth, kind: 'battle',
  });
  const b = launch(state, {
    pieces: empire, speed: [70, 110], slope: 0.02, faction: 'empire',
  }, {
    width, height, dir: -dir, y: y - 4, depth, kind: 'battle',
  });
  a.foe = b.id;
  b.foe = a.id;
  return [a, b];
}

function spawn(state, width, height, kind = pickKind(state.rand, LEVELS[0].kinds)) {
  if (kind === 'battle') return battle(state, width, height)[0];
  const { rand } = state;
  const built = buildPieces(kind, rand);
  // Depth: farther things are smaller, fainter and slower.
  return launch(state, built, {
    width, height, dir: rand() < 0.5 ? 1 : -1, y: between(rand, [0.1, 0.9]) * height, depth: between(rand, [0.45, 1]), kind,
  });
}

const offscreen = (e, width, height) => !e.pieces.length
  || (e.dir > 0 ? e.x - e.span > width + 8 : e.x + e.span < -8)
  || e.y < -height * 0.3 || e.y > height * 1.3;

const wobbleOf = (p, time) => (p.wobble ? Math.sin(time * 2.2 + p.phase) * p.wobble : 0);

// Screen position (px) of a piece's middle.
function pieceCenter(e, p, time) {
  const cw = e.size * TRAFFIC.cellW;
  const ch = e.size * TRAFFIC.cellH;
  return {
    x: e.x + (p.dx + spriteWidth(p.lines) / 2) * cw,
    y: e.y + (p.dy + wobbleOf(p, time) + (p.lines.length - 1) / 2) * ch,
  };
}

// A short laser streak leaving the front of a ship, faster than the ships.
function boltFrom(e, p, time) {
  const cw = e.size * TRAFFIC.cellW;
  const ch = e.size * TRAFFIC.cellH;
  const front = e.dir > 0 ? p.dx + spriteWidth(p.lines) + 1 : p.dx - 2;
  return {
    x: e.x + front * cw,
    y: e.y + (p.dy + wobbleOf(p, time) + Math.floor(p.lines.length / 2)) * ch,
    vx: e.vx * 2.4 + e.dir * 120,
    life: 0.7,
    maxLife: 0.7,
    size: e.size,
    alpha: Math.min(0.6, e.alpha * 1.6),
    color: LASER[e.faction] ?? LASER.empire,
    depth: e.depth,
    dir: e.dir,
  };
}

// In a battle a shot can take down a fighter of the other side that is on screen.
function maybeHit(state, e, width) {
  if (e.foe === null || state.rand() >= TRAFFIC.hitChance) return;
  const foe = state.events.find((f) => f.id === e.foe);
  if (!foe) return;
  const targets = foe.pieces.filter((p) => {
    if (p.armor) return false;
    const c = pieceCenter(foe, p, state.time);
    return c.x > 0 && c.x < width;
  });
  if (!targets.length) return;
  const target = pick(state.rand, targets);
  const at = pieceCenter(foe, target, state.time);
  foe.pieces = foe.pieces.filter((p) => p !== target);
  state.blasts.push({
    x: at.x, y: at.y, vx: foe.vx * 0.3, life: 0.9, maxLife: 0.9, size: foe.size, alpha: Math.min(0.7, foe.alpha * 2), depth: foe.depth,
  });
}

// Advances the traffic by dt seconds on a width × height screen, at the given level (1–5). A long
// pause (hidden tab) is cut short so nothing jumps across the screen.
function stepTraffic(state, dt, width, height, level = 1) {
  const conf = levelOf(level);
  const step = Math.min(Math.max(dt, 0), 0.1);
  state.time += step;
  for (const e of state.events) {
    e.x += e.vx * step;
    e.y += e.vy * step;
    const guns = e.pieces.filter((p) => p.gun);
    if (!guns.length) continue;
    e.nextShot -= step;
    if (e.nextShot <= 0) {
      e.nextShot = between(state.rand, e.foe === null ? [0.5, 1.8] : [0.2, 0.7]);
      state.bolts.push(boltFrom(e, pick(state.rand, guns), state.time));
      maybeHit(state, e, width);
    }
  }
  for (const b of [...state.bolts, ...state.blasts]) {
    b.x += b.vx * step;
    b.life -= step;
  }
  state.bolts = state.bolts.filter((b) => b.life > 0);
  state.blasts = state.blasts.filter((b) => b.life > 0);
  state.events = state.events.filter((e) => !offscreen(e, width, height));
  state.nextSpawn -= step;
  if (state.nextSpawn <= 0) {
    state.nextSpawn = between(state.rand, conf.gap);
    if (width > 0 && height > 0) {
      const kind = pickKind(state.rand, conf.kinds);
      const room = conf.max - state.events.length;
      if (room >= (kind === 'battle' ? 2 : 1)) spawn(state, width, height, kind);
    }
  }
}

// What to draw now: one entry per sprite line, in screen px (text baseline in the middle at y).
// `color` is set for lasers and explosions; ships use the sky's color. `depth` (0.45…1, nearer is
// bigger) and `dir` (1 right, -1 left) let the 3D sky place the glyph in space and mirror it when
// seen from behind.
function trafficGlyphs(state) {
  const out = [];
  for (const e of state.events) {
    const cw = e.size * TRAFFIC.cellW;
    const ch = e.size * TRAFFIC.cellH;
    for (const p of e.pieces) {
      const dy = p.dy + wobbleOf(p, state.time);
      p.lines.forEach((text, row) => {
        out.push({
          text, x: e.x + p.dx * cw, y: e.y + (dy + row) * ch, size: e.size, alpha: e.alpha * p.fade, depth: e.depth, dir: e.dir,
        });
      });
    }
  }
  for (const b of state.bolts) {
    out.push({
      text: '--', x: b.x, y: b.y, size: b.size, alpha: b.alpha * (b.life / b.maxLife), color: b.color, depth: b.depth, dir: b.dir,
    });
  }
  for (const b of state.blasts) {
    // Flash, burst, then sparks fading out, centered on where the ship was.
    const t = 1 - b.life / b.maxLife;
    const frame = SPRITES.explosion[Math.min(SPRITES.explosion.length - 1, Math.floor(t * SPRITES.explosion.length))];
    const cw = b.size * TRAFFIC.cellW;
    const ch = b.size * TRAFFIC.cellH;
    frame.forEach((text, row) => {
      out.push({
        text,
        x: b.x - (spriteWidth(frame) / 2) * cw,
        y: b.y + (row - (frame.length - 1) / 2) * ch,
        size: b.size,
        alpha: b.alpha * (1 - t * 0.6),
        color: EXPLOSION_COLOR,
        depth: b.depth,
        dir: 1,
      });
    });
  }
  return out;
}

module.exports = {
  SPRITES, TRAFFIC, LEVELS, LASER, mirror, createTraffic, spawn, stepTraffic, trafficGlyphs,
};
