import { prefs } from './prefs';

const api = window.docs;
const FONT_RE = /^[\p{L}\p{N} ,'"-]{0,120}$/u;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Mixes a color with white (amount > 0) or black (amount < 0).
function shade(hex, amount) {
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c + (target - c) * a));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function isLightTheme() {
  const theme = prefs.get('theme');
  return theme === 'light' || (theme === 'system' && !systemDark.matches);
}

// Theme, accent color, sizes and fonts from the preferences, as classes and CSS variables; the
// window's title bar buttons follow the theme.
export function applyAppearance() {
  const light = isLightTheme();
  const body = document.body;
  body.classList.toggle('theme-light', light);
  body.classList.toggle('theme-dark', !light);
  const accent = /^#[0-9a-f]{6}$/i.test(prefs.get('accentColor')) ? prefs.get('accentColor') : '#7f6df2';
  body.style.setProperty('--interactive-accent', accent);
  body.style.setProperty('--interactive-accent-hover', shade(accent, light ? -0.12 : 0.12));
  body.style.setProperty('--text-accent', shade(accent, light ? -0.15 : 0.25));
  body.style.setProperty('--accent-rgb', hexToRgb(accent).join(' '));
  body.style.setProperty('--ui-font-size', `${prefs.get('uiFontSize')}px`);
  for (const [key, prop] of [['textFont', '--font-text'], ['monoFont', '--font-mono-custom']]) {
    const value = prefs.get(key).trim();
    if (value && FONT_RE.test(value)) body.style.setProperty(prop, `${value}, var(--font-ui)`);
    else body.style.removeProperty(prop);
  }
  api.setTitleBarColors?.(light ? { color: '#f6f6f6', symbolColor: '#222222' } : { color: '#262626', symbolColor: '#dadada' }).catch?.(() => {});
}

export function setupAppearance() {
  applyAppearance();
  prefs.addEventListener('change', ({ detail }) => {
    if (['theme', 'accentColor', 'uiFontSize', 'textFont', 'monoFont'].includes(detail.key)) applyAppearance();
  });
  systemDark.addEventListener('change', () => {
    if (prefs.get('theme') === 'system') applyAppearance();
  });
}
