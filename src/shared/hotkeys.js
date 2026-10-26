'use strict';

// Hotkeys as canonical strings: "Mod+Shift+F" (Mod = Ctrl, or Cmd on macOS), modifiers in a fixed
// order, letters upper-case.
const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock']);
const ARROWS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

function keyName(event) {
  // With Shift held, "1" arrives as "!": use the physical digit.
  const digit = /^Digit(\d)$/.exec(event.code ?? '');
  if (digit) return digit[1];
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

function eventToHotkey(event) {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(keyName(event));
  return parts.join('+');
}

function normalizeHotkey(text) {
  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = parts.slice(0, -1).map((m) => {
    const lower = m.toLowerCase();
    if (lower === 'ctrl' || lower === 'cmd' || lower === 'mod') return 'Mod';
    return lower[0].toUpperCase() + lower.slice(1);
  });
  const key = parts[parts.length - 1];
  return [...ORDER.filter((m) => mods.includes(m)), key.length === 1 ? key.toUpperCase() : key].join('+');
}

function formatHotkey(hotkey) {
  return hotkey.split('+').map((p) => (p === 'Mod' ? 'Ctrl' : ARROWS[p] ?? p)).join(' + ');
}

module.exports = { eventToHotkey, normalizeHotkey, formatHotkey };
