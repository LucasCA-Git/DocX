'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseScene } = require('../src/shared/excalidraw-scene');

const rect = (extra = {}) => ({ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, ...extra });

test('parses the standard .excalidraw JSON, empty files included', () => {
  const scene = parseScene(JSON.stringify({ type: 'excalidraw', version: 2, elements: [rect()], appState: { viewBackgroundColor: '#fff' }, files: {} }));
  assert.deepEqual(scene.elements.map((e) => e.type), ['rectangle']);
  assert.equal(scene.appState.viewBackgroundColor, '#fff');
  assert.deepEqual(parseScene('  '), { elements: [], appState: {}, files: {} });
  assert.throws(() => parseScene('{"type":"outra-coisa"}'), /Excalidraw/);
});

test('drops elements that would render web content inside the app', () => {
  const scene = parseScene(JSON.stringify({
    type: 'excalidraw',
    elements: [
      rect(),
      { id: 'i', type: 'iframe', customData: { generationData: { status: 'done', html: '<form action=https://evil>' } } },
      { id: 'e', type: 'embeddable', link: 'https://evil.example' },
      null,
      'x',
    ],
  }));
  assert.deepEqual(scene.elements.map((e) => e.id), ['r']);
});

test('keeps only embedded images (data:image/…), never remote or script URLs', () => {
  const scene = parseScene(JSON.stringify({
    type: 'excalidraw',
    elements: [],
    files: {
      ok: { id: 'ok', mimeType: 'image/png', dataURL: 'data:image/png;base64,iVBOR' },
      remote: { id: 'remote', mimeType: 'image/png', dataURL: 'https://evil.example/pixel.png' },
      html: { id: 'html', mimeType: 'text/html', dataURL: 'data:text/html,<script>' },
      bad: null,
    },
  }));
  assert.deepEqual(Object.keys(scene.files), ['ok']);
});

test('element links: notes and web pages only', () => {
  const links = ['[[Nota]]', '[[Pasta/Nota#Título|apelido]]', 'https://example.com', 'http://x.y', 'javascript:alert(1)', 'file:///C:/x', 'vault-asset://local/a.png', '//evil', 42];
  const scene = parseScene(JSON.stringify({ type: 'excalidraw', elements: links.map((link, i) => rect({ id: String(i), link })) }));
  assert.deepEqual(scene.elements.map((e) => e.link), ['[[Nota]]', '[[Pasta/Nota#Título|apelido]]', 'https://example.com', 'http://x.y', null, null, null, null, null]);
});
