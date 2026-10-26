'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eventToHotkey, formatHotkey, normalizeHotkey } = require('../src/shared/hotkeys');

const ev = (key, mods = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

test('eventToHotkey builds a canonical name', () => {
  assert.equal(eventToHotkey(ev('p', { ctrlKey: true })), 'Mod+P');
  assert.equal(eventToHotkey(ev('F', { ctrlKey: true, shiftKey: true })), 'Mod+Shift+F');
  assert.equal(eventToHotkey(ev('ArrowLeft', { altKey: true })), 'Alt+ArrowLeft');
  assert.equal(eventToHotkey(ev('Tab', { ctrlKey: true, shiftKey: true })), 'Mod+Shift+Tab');
  assert.equal(eventToHotkey(ev('\\', { ctrlKey: true })), 'Mod+\\');
  assert.equal(eventToHotkey(ev('Control', { ctrlKey: true })), null);
  assert.equal(eventToHotkey(ev('a')), 'A');
});

test('Shift+digit and keyboard layouts use the physical key for letters and digits', () => {
  assert.equal(eventToHotkey({ ...ev('!', { ctrlKey: true, shiftKey: true }), code: 'Digit1' }), 'Mod+Shift+1');
  assert.equal(eventToHotkey({ ...ev('ç', { ctrlKey: true }), code: 'Semicolon' }), 'Mod+Ç');
});

test('normalizeHotkey and formatHotkey', () => {
  assert.equal(normalizeHotkey('shift+mod+f'), 'Mod+Shift+F');
  assert.equal(formatHotkey('Mod+Shift+F'), 'Ctrl + Shift + F');
  assert.equal(formatHotkey('Alt+ArrowLeft'), 'Alt + ←');
});
