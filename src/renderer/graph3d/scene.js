import * as THREE from 'three';
import { glowSprite, sunSprite, galaxySprite, folderHue } from '../graph-sprites';
import { makeStarfield3 } from '../../shared/graph-physics';
import {
  createOrbit, orbitPosition, orbitBasis, rotateOrbit, zoomOrbit, panOrbit, fitOrbit, focusOrbit, flyOrbit, autoRotate,
} from '../../shared/orbit-camera';
import { stepTraffic, trafficGlyphs } from '../../shared/space-traffic';

// The 3D Graph View: the same constellation as the flat graph, in space, seen through a camera
// that orbits it (see orbit-camera.js). WebGL (three.js) draws the sky, the stars (notes), suns,
// galaxies and links; the graph's 2D canvas sits on top, transparent, and gets the labels, the
// pinned rings and the ASCII ships, projected from 3D. The graph view owns the data, the worker
// and the input; this class only draws, moves the camera and finds what is under the pointer.

const FOV = 55;
const SKY_STARS = makeStarfield3(1600, 2026);
const SKY_RADIUS = 1000;
// The traffic is simulated on a virtual screen, then laid out in a slab of space around the graph.
const TRAFFIC_W = 1600;
const TRAFFIC_H = 1000;
const TRAFFIC_FONT = 'ui-monospace, "Cascadia Code", Consolas, monospace';
const FLY_MS = 900;

// Colors and textures as given, like the flat canvas (no sRGB conversion), so both modes match.
THREE.ColorManagement.enabled = false;

// Any CSS color → { color: THREE.Color, alpha }, cached (theme colors are read every frame).
const parsed = new Map();
const probe = document.createElement('canvas').getContext('2d');
function cssColor(css) {
  if (!parsed.has(css)) {
    probe.fillStyle = '#000000';
    probe.fillStyle = css;
    const value = probe.fillStyle;
    let out;
    const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
    if (rgba) {
      const [r, g, b, a = '1'] = rgba[1].split(',').map((v) => v.trim());
      out = { color: new THREE.Color(r / 255, g / 255, b / 255), alpha: Number(a) };
    } else {
      out = { color: new THREE.Color(value), alpha: 1 };
    }
    parsed.set(css, out);
  }
  return parsed.get(css);
}

// Point textures computed by hand (no canvas premultiplying): red = how white-hot, alpha = halo.
function pointTexture(kind) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const ramp = (d, stops) => {
    for (let i = 1; i < stops.length; i++) {
      if (d <= stops[i][0]) {
        const [d0, v0] = stops[i - 1];
        const [d1, v1] = stops[i];
        return v0 + ((v1 - v0) * (d - d0)) / (d1 - d0);
      }
    }
    return stops[stops.length - 1][1];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const o = (y * size + x) * 4;
      let white;
      let alpha;
      if (kind === 'glow') {
        // Same profile as the flat graph's star: white core, colored halo fading out.
        white = ramp(d, [[0, 1], [0.16, 1], [0.3, 0], [1, 0]]);
        alpha = ramp(d, [[0, 1], [0.16, 0.95], [0.3, 0.95], [0.55, 0.28], [1, 0]]);
      } else {
        white = 0;
        alpha = d < 0.94 ? 1 : Math.max(0, (1 - d) / 0.06);
      }
      data[o] = Math.round(white * 255);
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

const POINT_VERTEX = `
uniform float uScale;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uTime;
uniform float uTwinkle;
attribute float size;
attribute float alpha;
attribute float phase;
attribute vec3 tint;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(1.0, -mv.z);
  gl_PointSize = clamp(size * uScale / d, 1.5, 512.0);
  float fade = 1.0 - 0.75 * smoothstep(uFadeNear, uFadeFar, d);
  float tw = mix(1.0, 0.8 + 0.2 * sin(uTime * 0.05 + phase), uTwinkle);
  vAlpha = alpha * fade * tw;
  vTint = tint;
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAGMENT = `
uniform sampler2D uTex;
uniform float uGlow;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(vTint, vec3(1.0), t.r * uGlow), a);
}`;

// Background stars: fixed pixel size, twinkling, always behind everything.
const SKY_VERTEX = `
uniform float uTime;
uniform float uPixel;
attribute float size;
attribute float base;
attribute float phase;
varying float vAlpha;
void main() {
  vAlpha = clamp(base * (0.7 + 0.3 * sin(uTime * 0.045 + phase) * sin(uTime * 0.017 + phase * 2.0)), 0.0, 1.0);
  gl_PointSize = size * uPixel;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = `
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = vAlpha * smoothstep(0.5, 0.15, length(p));
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.9, 0.93, 1.0, a);
}`;

const canvasTexture = (canvas) => {
  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter;
  return t;
};

// A stable number in [0, 1) from a string (the tilt of a galaxy).
function hash01(text, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export class Graph3D {
  // host: the element to put the WebGL canvas in (under the overlay canvas). Throws when WebGL is
  // not available.
  constructor({ host, onContextLost }) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    try {
      this.setup(host, onContextLost);
    } catch (err) {
      this.renderer.forceContextLoss();
      this.renderer.dispose();
      this.renderer.domElement.remove();
      throw err;
    }
  }

  setup(host, onContextLost) {
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'graph-canvas-3d';
    this.onLost = (e) => {
      e.preventDefault();
      if (!this.disposed) onContextLost?.();
    };
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    host.prepend(this.canvas);
    this.blending = THREE.AdditiveBlending;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
    this.orbit = createOrbit();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.lastInput = performance.now();
    this.lastFrame = 0;
    this.flight = null;
    this.bounds = { x: 0, y: 0, z: 0, radius: 300 };
    this.nodes = [];
    this.linkIndex = [];
    this.starIndex = [];
    this.bodyOf = new Map();
    this.positions = new Float32Array(0);
    this.screen = { x: new Float32Array(0), y: new Float32Array(0), r: new Float32Array(0), d: new Float32Array(0) };
    this.textures = { glow: pointTexture('glow'), dot: pointTexture('dot'), sun: canvasTexture(sunSprite()), galaxies: new Map(), glows: new Map() };
    this.backgroundKey = null;
    this.raycaster = new THREE.Raycaster();
    this.scratch = new THREE.Vector3();

    this.buildSky();
    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.textures.glow }, uGlow: { value: 1 }, uScale: { value: 1 }, uFadeNear: { value: 0 }, uFadeFar: { value: 1 }, uTime: { value: 0 }, uTwinkle: { value: 1 },
      },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.linkMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.hoverMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
    this.points = null;
    this.links = null;
    this.hoverLinks = null;
    this.hoverPairs = [];
    this.hoverOf = -2;
    this.bodies = new THREE.Group();
    this.scene.add(this.bodies);
    this.scene.fog = new THREE.Fog(0x000000, 1, 2);
  }

  // ---------- data ----------

  buildSky() {
    const n = SKY_STARS.length;
    const position = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const base = new Float32Array(n);
    const phase = new Float32Array(n);
    SKY_STARS.forEach((s, i) => {
      position.set([s.x * SKY_RADIUS, s.y * SKY_RADIUS, s.z * SKY_RADIUS], i * 3);
      size[i] = s.size;
      base[i] = s.base;
      phase[i] = s.phase;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geometry.setAttribute('base', new THREE.BufferAttribute(base, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Points(geometry, this.skyMaterial);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  glowTexture(color) {
    if (!this.textures.glows.has(color)) this.textures.glows.set(color, canvasTexture(glowSprite(color)));
    return this.textures.glows.get(color);
  }

  galaxyTexture(hue) {
    if (!this.textures.galaxies.has(hue)) this.textures.galaxies.set(hue, canvasTexture(galaxySprite(hue)));
    return this.textures.galaxies.get(hue);
  }

  // A new set of nodes and links (positions follow with setPositions): rebuilds the buffers.
  setGraph(nodes, linkIndex) {
    this.disposeGraph();
    this.nodes = nodes;
    this.linkIndex = linkIndex;
    const count = nodes.length;
    this.screen = { x: new Float32Array(count), y: new Float32Array(count), r: new Float32Array(count), d: new Float32Array(count).fill(-1) };

    // Stars (notes, attachments, tags, missing notes): one Points draw call for all of them.
    this.starIndex = [];
    this.bodyOf = new Map();
    nodes.forEach((n, i) => {
      if (n.type !== 'galaxy' && n.type !== 'sun') this.starIndex.push(i);
    });
    const m = this.starIndex.length;
    const geometry = new THREE.BufferGeometry();
    const attr = (name, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(Math.max(1, m) * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, a);
      return a;
    };
    attr('position', 3);
    attr('tint', 3);
    attr('size', 1);
    attr('alpha', 1);
    const phase = attr('phase', 1);
    this.starIndex.forEach((i, k) => {
      phase.array[k] = i * 2.4;
    });
    geometry.setDrawRange(0, m);
    this.points = new THREE.Points(geometry, this.pointMaterial);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Suns and galaxies: a few bigger bodies, each its own object.
    nodes.forEach((n, i) => {
      if (n.type === 'sun') {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.textures.sun, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        this.bodies.add(sprite);
        this.bodyOf.set(i, { sprite });
      } else if (n.type === 'galaxy') {
        this.bodyOf.set(i, this.makeGalaxy(n, i));
      }
    });

    const lines = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(Math.max(1, linkIndex.length) * 6), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    lines.setAttribute('position', pos);
    lines.setDrawRange(0, linkIndex.length * 2);
    this.links = new THREE.LineSegments(lines, this.linkMaterial);
    this.links.frustumCulled = false;
    this.scene.add(this.links);
    this.hoverOf = -2;
    if (this.blending !== THREE.AdditiveBlending) this.setBlending(this.blending);
  }

  // A spiral galaxy seen at an angle, slowly turning, with a little solar system in its middle (a
  // preview of the folder: a sun and one planet per doc, up to 12, on a few rings).
  makeGalaxy(node, index) {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.set(-Math.PI / 2 + 0.35 + hash01(node.folder, 1) * 0.7, hash01(node.folder, 2) * Math.PI * 2, 0, 'YXZ');
    group.add(tilt);
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.galaxyTexture(folderHue(node.folder)), side: THREE.DoubleSide, ...additive,
    }));
    tilt.add(disc);
    // Seen edge-on the disc is a thin line: a soft glow keeps the galaxy visible from any side.
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture('#b9a8ff'), ...additive, opacity: 0.55 }));
    group.add(core);
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.sun, ...additive }));
    tilt.add(sun);
    const planets = Math.min(12, Math.max(0, (node.count ?? 1) - 1));
    const rings = [];
    for (let p = 0; p < Math.min(4, planets); p++) {
      const radius = 0.32 + p * 0.17;
      const pts = [];
      for (let a = 0; a <= 48; a++) pts.push(new THREE.Vector3(Math.cos((a / 48) * Math.PI * 2) * radius, Math.sin((a / 48) * Math.PI * 2) * radius, 0));
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xfff0d2, opacity: 0.18, ...additive }));
      tilt.add(ring);
      rings.push(ring);
    }
    const planetGeometry = new THREE.BufferGeometry();
    planetGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, planets) * 3), 3));
    planetGeometry.setDrawRange(0, planets);
    const planetPoints = new THREE.Points(planetGeometry, new THREE.PointsMaterial({
      map: this.glowTexture('#cfe0ff'), size: 1, sizeAttenuation: true, ...additive,
    }));
    planetPoints.frustumCulled = false;
    tilt.add(planetPoints);
    this.bodies.add(group);
    return { group, tilt, disc, core, sun, rings, planets, planetPoints, seed: index };
  }

  setPositions(positions) {
    this.positions = positions;
  }

  // ---------- camera ----------

  touch() {
    this.lastInput = performance.now();
  }

  rotate(dx, dy) {
    this.flight = null;
    this.orbit = rotateOrbit(this.orbit, dx, dy);
    this.touch();
  }

  pan(dx, dy) {
    this.flight = null;
    this.orbit = panOrbit(this.orbit, dx, dy, this.height, FOV);
    this.touch();
  }

  zoom(factor) {
    this.flight = null;
    this.orbit = zoomOrbit(this.orbit, factor);
    this.touch();
  }

  // The whole graph in view, from where the camera is looking now.
  fit() {
    this.measure();
    this.flight = null;
    this.orbit = fitOrbit(this.orbit, this.bounds, FOV, this.width / this.height);
  }

  // Flies close to a node (double click).
  flyTo(i, radius) {
    this.flight = { from: this.orbit, to: focusOrbit(this.orbit, this.pointOf(i), radius), start: performance.now() };
    this.touch();
  }

  getOrbit() {
    return { ...this.orbit };
  }

  setOrbit(orbit) {
    this.flight = null;
    this.orbit = { ...orbit };
  }

  pointOf(i) {
    const p = this.positions;
    return { x: p[i * 3] || 0, y: p[i * 3 + 1] || 0, z: p[i * 3 + 2] || 0 };
  }

  // Center and radius of the graph.
  measure() {
    const n = this.nodes.length;
    if (!n || this.positions.length < n * 3) return this.bounds;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = this.positions[i * 3];
      const y = this.positions[i * 3 + 1];
      const z = this.positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const c = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    let radius = 0;
    for (let i = 0; i < n; i++) {
      const r = (this.nodes[i].radius ?? 4) * 2;
      radius = Math.max(radius, Math.hypot(this.positions[i * 3] - c.x, this.positions[i * 3 + 1] - c.y, this.positions[i * 3 + 2] - c.z) + r);
    }
    if ([c.x, c.y, c.z, radius].every(Number.isFinite)) this.bounds = { ...c, radius: Math.max(radius, 40) };
    return this.bounds;
  }

  // ---------- picking and dragging ----------

  // The node under (px, py) in CSS pixels (the nearest one when they overlap), or -1. With `core`,
  // only the bright middle of a body counts (to grab it for a drag): around a big galaxy or sun a
  // drag still turns the view.
  pick(px, py, { core = false } = {}) {
    const { x, y, r, d } = this.screen;
    let best = -1;
    let bestDepth = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      if (!(d[i] > 0)) continue;
      const type = this.nodes[i].type;
      const big = type === 'galaxy' || type === 'sun';
      const reach = core ? Math.max(8, r[i] * (big ? 0.6 : 1.1)) : Math.max(6, r[i] * (big ? 1.5 : 1.2));
      const dx = px - x[i];
      const dy = py - y[i];
      if (dx * dx + dy * dy <= reach * reach && d[i] < bestDepth) {
        best = i;
        bestDepth = d[i];
      }
    }
    return best;
  }

  // Where node i goes when dragged to (px, py): on the plane through it, facing the camera.
  dragPoint(i, px, py) {
    const p = this.pointOf(i);
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(p.x, p.y, p.z));
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y, z: hit.z } : p;
  }

  // ---------- drawing ----------

  resize(width, height, dpr) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  // Sky background: the same deep blue gradient as the flat graph, tinted inside a galaxy; the
  // theme's background without the constellation look.
  setBackground(sky, hue, plainColor) {
    const key = sky ? `sky:${hue}` : `plain:${plainColor}`;
    if (key === this.backgroundKey) return;
    this.backgroundKey = key;
    if (this.scene.background?.isTexture) this.scene.background.dispose();
    if (!sky) {
      this.scene.background = cssColor(plainColor).color.clone();
      return;
    }
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    const g = c.createRadialGradient(size * 0.5, size * 0.45, 0, size * 0.5, size * 0.5, size * 0.8);
    g.addColorStop(0, hue === null ? '#16203f' : `hsl(${hue}, 45%, 17%)`);
    g.addColorStop(0.5, hue === null ? '#0c1129' : `hsl(${hue}, 40%, 10%)`);
    g.addColorStop(1, '#04050c');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    this.scene.background = canvasTexture(canvas);
  }

  // Draws one frame. state: { hover, neighbours, pinned (Set of ids), style, folder, overlay
  // (2D context of the canvas on top), traffic, trafficOn, trafficLevel, autoRotate, busy,
  // reducedMotion }. style: { sky, palette, highlight, groupColors, nodeSize, background, label,
  // link, ship }. Returns true while something keeps moving (the caller asks for another frame).
  render(state) {
    const now = performance.now();
    const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    const time = now / 16.667;
    const { style } = state;
    const sky = style.sky;
    const bounds = this.measure();

    // Camera: a flight in progress, or the slow turn when idle.
    if (this.flight) {
      const t = Math.min(1, (now - this.flight.start) / FLY_MS);
      this.orbit = flyOrbit(this.flight.from, this.flight.to, t);
      if (t >= 1) this.flight = null;
    } else if (state.autoRotate && !state.busy && !state.reducedMotion) {
      this.orbit = autoRotate(this.orbit, { idle: (now - this.lastInput) / 1000, dt });
    }
    const eye = orbitPosition(this.orbit);
    const toCenter = Math.hypot(eye.x - bounds.x, eye.y - bounds.y, eye.z - bounds.z);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.lookAt(this.orbit.tx, this.orbit.ty, this.orbit.tz);
    this.camera.near = Math.max(0.5, this.orbit.distance * 0.002);
    this.camera.far = Math.max(SKY_RADIUS * 2, toCenter + bounds.radius * 4);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const b = orbitBasis(this.orbit);
    this.forward.set(b.forward.x, b.forward.y, b.forward.z);

    // Depth: the far side of the graph fades into the dark (stars, bodies and links alike).
    const fadeNear = Math.max(1, toCenter - bounds.radius * 0.2);
    const fadeFar = toCenter + bounds.radius * 1.4;
    this.scene.fog.near = fadeNear;
    this.scene.fog.far = fadeNear + (fadeFar - fadeNear) * 1.6;
    if (sky) this.scene.fog.color.setRGB(0, 0, 0);
    else this.scene.fog.color.copy(cssColor(style.background).color);
    const blending = sky ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.setBackground(sky, state.folder ? folderHue(state.folder) : null, style.background);
    this.sky.visible = sky;
    this.sky.position.copy(this.camera.position);
    this.skyMaterial.uniforms.uTime.value = time;
    this.skyMaterial.uniforms.uPixel.value = this.dpr;

    const focal = this.height / (2 * Math.tan((FOV * Math.PI) / 360));
    const u = this.pointMaterial.uniforms;
    u.uScale.value = focal * this.dpr;
    u.uFadeNear.value = fadeNear;
    u.uFadeFar.value = fadeFar;
    u.uTime.value = time;
    u.uTwinkle.value = sky ? 1 : 0;
    u.uGlow.value = sky ? 1 : 0;
    u.uTex.value = sky ? this.textures.glow : this.textures.dot;
    if (this.blending !== blending) this.setBlending(blending);

    const { hover } = state;
    const near = hover >= 0 ? state.neighbours[hover] : null;
    const lit = (i) => i === hover || Boolean(near?.has(i));
    const dim = (i) => hover >= 0 && !lit(i);
    const colorOf = (i) => (i === hover ? style.highlight : style.groupColors[this.nodes[i].group] ?? style.palette[this.nodes[i].type] ?? style.palette.note);
    const radiusOf = (i) => (this.nodes[i].radius ?? 4) * style.nodeSize;
    const P = this.positions;
    const ready = P.length >= this.nodes.length * 3;

    // Stars.
    if (this.points && ready) {
      const g = this.points.geometry;
      const pos = g.attributes.position.array;
      const tint = g.attributes.tint.array;
      const size = g.attributes.size.array;
      const alpha = g.attributes.alpha.array;
      this.starIndex.forEach((i, k) => {
        pos[k * 3] = P[i * 3];
        pos[k * 3 + 1] = P[i * 3 + 1];
        pos[k * 3 + 2] = P[i * 3 + 2];
        const c = cssColor(colorOf(i)).color;
        tint[k * 3] = c.r;
        tint[k * 3 + 1] = c.g;
        tint[k * 3 + 2] = c.b;
        size[k] = radiusOf(i) * (sky ? 4 : 2);
        alpha[k] = dim(i) ? 0.25 : 1;
      });
      for (const name of ['position', 'tint', 'size', 'alpha']) g.attributes[name].needsUpdate = true;
    }

    // Suns and galaxies.
    if (ready) {
      for (const [i, body] of this.bodyOf) {
        const p = this.pointOf(i);
        const r = radiusOf(i);
        const opacity = dim(i) ? 0.3 : 1;
        if (body.sprite) {
          const pulse = 1 + 0.06 * Math.sin(time * 0.04 + i);
          body.sprite.position.set(p.x, p.y, p.z);
          body.sprite.scale.setScalar(r * 5.2 * pulse);
          body.sprite.material.opacity = opacity;
          continue;
        }
        body.group.position.set(p.x, p.y, p.z);
        body.disc.scale.setScalar(r * 3.2);
        body.disc.rotation.z = -time * 0.004 - body.seed * 1.7;
        body.disc.material.opacity = opacity;
        body.core.scale.setScalar(r * 1.6);
        body.core.material.opacity = 0.55 * opacity;
        body.sun.scale.setScalar(Math.max(2.5, r * 0.16) * 5.2);
        body.sun.material.opacity = opacity;
        for (const ring of body.rings) ring.scale.setScalar(r);
        const planetPos = body.planetPoints.geometry.attributes.position;
        for (let k = 0; k < body.planets; k++) {
          const ring = 0.32 + (k % 4) * 0.17;
          const angle = body.seed * 2.1 + k * 2.399 + (time * 0.03) / Math.sqrt(ring * 4);
          planetPos.array[k * 3] = Math.cos(angle) * r * ring;
          planetPos.array[k * 3 + 1] = Math.sin(angle) * r * ring;
          planetPos.array[k * 3 + 2] = 0;
        }
        planetPos.needsUpdate = true;
        body.planetPoints.material.size = Math.max(1, r * 0.06) * 4;
        body.planetPoints.material.opacity = 0.9 * opacity;
      }
    }

    // Links, and the hovered node's links in the accent color.
    const link = cssColor(style.link);
    this.linkMaterial.color.copy(link.color);
    this.linkMaterial.opacity = link.alpha * (hover >= 0 ? 0.35 : 1);
    if (this.links && ready) {
      const arr = this.links.geometry.attributes.position.array;
      for (let k = 0; k < this.linkIndex.length; k++) {
        const [a, c] = this.linkIndex[k];
        const o = k * 6;
        arr[o] = P[a * 3];
        arr[o + 1] = P[a * 3 + 1];
        arr[o + 2] = P[a * 3 + 2];
        arr[o + 3] = P[c * 3];
        arr[o + 4] = P[c * 3 + 1];
        arr[o + 5] = P[c * 3 + 2];
      }
      this.links.geometry.attributes.position.needsUpdate = true;
    }
    this.updateHoverLinks(hover, style.highlight, ready);

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(state, { focal, fadeNear, fadeFar, radiusOf, lit, dim, ready, dt });
    return sky || Boolean(this.flight) || Boolean(state.autoRotate && !state.reducedMotion);
  }

  // Glow adds light on the dark sky; on the theme's (maybe light) background everything is drawn
  // normally, or it would wash out.
  setBlending(blending) {
    this.blending = blending;
    const materials = [this.pointMaterial, this.linkMaterial, this.hoverMaterial];
    this.bodies.traverse((o) => {
      if (o.material) materials.push(o.material);
    });
    for (const m of materials) {
      m.blending = blending;
      m.needsUpdate = true;
    }
  }

  updateHoverLinks(hover, color, ready) {
    if (hover !== this.hoverOf) {
      this.hoverOf = hover;
      if (this.hoverLinks) {
        this.scene.remove(this.hoverLinks);
        this.hoverLinks.geometry.dispose();
        this.hoverLinks = null;
      }
      if (hover >= 0) {
        this.hoverPairs = this.linkIndex.filter(([a, b]) => a === hover || b === hover);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, this.hoverPairs.length) * 6), 3));
        g.setDrawRange(0, this.hoverPairs.length * 2);
        this.hoverLinks = new THREE.LineSegments(g, this.hoverMaterial);
        this.hoverLinks.frustumCulled = false;
        this.hoverLinks.renderOrder = 1;
        this.scene.add(this.hoverLinks);
      }
    }
    if (!this.hoverLinks || !ready) return;
    this.hoverMaterial.color.copy(cssColor(color).color);
    this.hoverMaterial.opacity = 1;
    const P = this.positions;
    const arr = this.hoverLinks.geometry.attributes.position.array;
    this.hoverPairs.forEach(([a, b], k) => {
      arr.set([P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], k * 6);
    });
    this.hoverLinks.geometry.attributes.position.needsUpdate = true;
  }

  // Screen position (CSS px) and view depth of a world point; depth <= 0 is behind the camera.
  project(x, y, z) {
    const v = this.scratch;
    v.set(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
    const depth = v.dot(this.forward);
    v.set(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, depth };
  }

  // The 2D layer on top: labels facing the camera (fading with distance), pinned rings, a ring on
  // the hovered sun or galaxy, and the ASCII traffic placed in space.
  drawOverlay(state, { focal, fadeNear, fadeFar, radiusOf, lit, dim, ready, dt }) {
    const ctx = state.overlay;
    const { style } = state;
    const { width, height, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!ready) return;
    const fade = (depth) => 1 - 0.75 * Math.min(1, Math.max(0, (depth - fadeNear) / Math.max(1, fadeFar - fadeNear)));

    if (sky(style) && state.trafficOn && state.traffic && !state.reducedMotion) this.drawTraffic(ctx, state, focal, fade, dt);

    const { x: sx, y: sy, r: sr, d: sd } = this.screen;
    const P = this.positions;
    for (let i = 0; i < this.nodes.length; i++) {
      const s = this.project(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      sx[i] = s.x;
      sy[i] = s.y;
      sd[i] = s.depth > this.camera.near ? s.depth : -1;
      sr[i] = sd[i] > 0 ? (radiusOf(i) * focal) / s.depth : 0;
    }

    // Labels: the closer (bigger on screen) a star is, the clearer its name. Suns and galaxies
    // are landmarks and always named; the hovered node and its neighbours too.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = style.label;
    ctx.font = '12px Inter, system-ui, sans-serif';
    const landmarks = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (!(sd[i] > 0) || sx[i] < -80 || sx[i] > width + 80 || sy[i] < -40 || sy[i] > height + 40) continue;
      const n = this.nodes[i];
      if (n.type === 'galaxy' || n.type === 'sun') {
        landmarks.push(i);
        continue;
      }
      let alpha = Math.min(1, Math.max(0, (sr[i] - 4.5) / 4)) * fade(sd[i]);
      if (lit(i)) alpha = 1;
      else if (state.hover >= 0) alpha *= 0.3;
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillText(n.label, sx[i], sy[i] + sr[i] * (style.sky ? 1.4 : 1) + 4);
    }
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    for (const i of landmarks) {
      const n = this.nodes[i];
      ctx.globalAlpha = dim(i) ? 0.35 : Math.max(0.45, fade(sd[i]));
      const text = n.type === 'galaxy' ? `${n.label} · ${n.count}` : n.label;
      ctx.fillText(text, sx[i], sy[i] + sr[i] * (n.type === 'galaxy' ? 0.9 : 1.6) + 6);
    }

    // Pinned nodes: a thin dashed ring; the hovered sun or galaxy: an accent ring.
    ctx.lineWidth = 1;
    ctx.strokeStyle = style.highlight;
    if (state.pinned.size) {
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([3, 3]);
      for (let i = 0; i < this.nodes.length; i++) {
        if (!(sd[i] > 0) || !state.pinned.has(this.nodes[i].id)) continue;
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], sr[i] + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const h = state.hover;
    if (h >= 0 && sd[h] > 0 && (this.nodes[h].type === 'galaxy' || this.nodes[h].type === 'sun')) {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx[h], sy[h], sr[h] * 1.5 + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Ships, fleets and asteroids: simulated on a virtual screen, then set in a slab of space around
  // the graph (deeper ones farther back). Their text always faces the camera, mirrored when seen
  // from behind so they still fly nose first.
  drawTraffic(ctx, state, focal, fade, dt) {
    stepTraffic(state.traffic, dt, TRAFFIC_W, TRAFFIC_H, state.trafficLevel);
    const glyphs = trafficGlyphs(state.traffic);
    if (!glyphs.length) return;
    const c = this.bounds;
    const R = Math.max(c.radius, 300);
    const s = (R * 2.6) / TRAFFIC_W;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const g of glyphs) {
      const dir = g.dir ?? 1;
      const wx = c.x + (g.x - TRAFFIC_W / 2) * s;
      const wy = c.y - (g.y - TRAFFIC_H / 2) * s;
      const wz = c.z + (0.725 - (g.depth ?? 0.7)) * R * 3;
      const at = this.project(wx, wy, wz);
      if (at.depth <= this.camera.near) continue;
      const px = (g.size * s * focal) / at.depth;
      if (px < 4 || px > 90) continue;
      const ahead = this.project(wx + dir * s * 20, wy, wz);
      const flip = (ahead.x - at.x) * dir < 0;
      ctx.globalAlpha = Math.min(1, g.alpha * 1.4) * fade(at.depth);
      ctx.fillStyle = g.color ?? state.style.ship;
      ctx.font = `${px.toFixed(1)}px ${TRAFFIC_FONT}`;
      if (flip) {
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.scale(-1, 1);
        ctx.fillText(g.text, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(g.text, at.x, at.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- cleanup ----------

  disposeGraph() {
    for (const key of ['points', 'links', 'hoverLinks']) {
      if (!this[key]) continue;
      this.scene.remove(this[key]);
      this[key].geometry.dispose();
      this[key] = null;
    }
    this.bodies.traverse((o) => {
      if (o === this.bodies) return;
      // Sprites share one geometry inside three.js: only their material is theirs.
      if (!o.isSprite) o.geometry?.dispose();
      o.material?.dispose();
    });
    this.bodies.clear();
  }

  dispose() {
    this.disposeGraph();
    this.sky.geometry.dispose();
    this.skyMaterial.dispose();
    this.pointMaterial.dispose();
    this.linkMaterial.dispose();
    this.hoverMaterial.dispose();
    if (this.scene.background?.isTexture) this.scene.background.dispose();
    for (const t of [this.textures.glow, this.textures.dot, this.textures.sun, ...this.textures.galaxies.values(), ...this.textures.glows.values()]) t.dispose();
    // Give the GL context back now (Chromium keeps only a few alive at once).
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const sky = (style) => Boolean(style.sky);
