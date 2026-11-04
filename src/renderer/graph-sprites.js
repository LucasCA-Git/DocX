// Pre-drawn canvases for the graph (2D and 3D): glowing stars, suns, spiral galaxies, plain dots.
// Each is drawn once per color and reused.

export const SPRITE_SIZE = 64;

export const withAlpha = (color, a) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return `rgba(255, 255, 255, ${a})`;
  const n = parseInt(hex[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// A star: white core, colored halo fading out. Drawn at twice the node's radius.
const GLOWS = new Map();
export function glowSprite(color) {
  if (!GLOWS.has(color)) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const c = canvas.getContext('2d');
    const half = SPRITE_SIZE / 2;
    const g = c.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.16, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.3, withAlpha(color, 0.95));
    g.addColorStop(0.55, withAlpha(color, 0.28));
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    GLOWS.set(color, canvas);
  }
  return GLOWS.get(color);
}

// Each folder keeps its own color (from its path): its galaxy, and the sky while inside it.
export function folderHue(folder) {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (Math.imul(h, 31) + folder.charCodeAt(i)) >>> 0;
  return h % 360;
}

// A spiral galaxy seen from above: bright core, two arms of stars, soft disc. Drawn at 1.6x the
// node's radius and turned a little every frame.
const GALAXIES = new Map();
export function galaxySprite(hue) {
  if (!GALAXIES.has(hue)) {
    const size = 160;
    const half = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    const disc = c.createRadialGradient(half, half, 0, half, half, half);
    disc.addColorStop(0, 'rgba(255, 250, 235, 1)');
    disc.addColorStop(0.12, `hsla(${hue}, 90%, 85%, 0.9)`);
    disc.addColorStop(0.45, `hsla(${hue}, 70%, 60%, 0.22)`);
    disc.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = disc;
    c.fillRect(0, 0, size, size);
    const rand = (() => {
      let a = hue * 7919 + 1;
      return () => {
        a = (a * 16807) % 2147483647;
        return a / 2147483647;
      };
    })();
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 140; i++) {
        const t = i / 140;
        const angle = arm * Math.PI + t * Math.PI * 2.6;
        const dist = 6 + t * (half - 10);
        const spread = 3 + t * 9;
        const x = half + Math.cos(angle) * dist + (rand() - 0.5) * spread;
        const y = half + Math.sin(angle) * dist + (rand() - 0.5) * spread;
        c.globalAlpha = (1 - t) * 0.8 + 0.15;
        c.fillStyle = rand() < 0.3 ? '#ffffff' : `hsl(${hue}, 85%, ${70 + rand() * 20}%)`;
        c.fillRect(x, y, 1 + rand() * 1.4, 1 + rand() * 1.4);
      }
    }
    GALAXIES.set(hue, canvas);
  }
  return GALAXIES.get(hue);
}

// A sun: white-hot center, yellow body, orange corona. Drawn at 2.6x the node's radius.
let SUN = null;
export function sunSprite() {
  if (!SUN) {
    SUN = document.createElement('canvas');
    SUN.width = SPRITE_SIZE * 2;
    SUN.height = SPRITE_SIZE * 2;
    const c = SUN.getContext('2d');
    const half = SPRITE_SIZE;
    const g = c.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, 'rgba(255, 255, 245, 1)');
    g.addColorStop(0.2, 'rgba(255, 236, 160, 1)');
    g.addColorStop(0.36, 'rgba(255, 196, 70, 0.95)');
    g.addColorStop(0.5, 'rgba(255, 140, 40, 0.4)');
    g.addColorStop(0.75, 'rgba(255, 110, 30, 0.1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, half * 2, half * 2);
  }
  return SUN;
}

// One antialiased circle per color, scaled to each node's size when drawn.
const SPRITES = new Map();
export function sprite(color) {
  if (!SPRITES.has(color)) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const c = canvas.getContext('2d');
    c.fillStyle = color;
    c.beginPath();
    c.arc(SPRITE_SIZE / 2, SPRITE_SIZE / 2, SPRITE_SIZE / 2 - 1, 0, Math.PI * 2);
    c.fill();
    SPRITES.set(color, canvas);
  }
  return SPRITES.get(color);
}
