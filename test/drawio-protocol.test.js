'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DRAWIO_ORIGIN, drawioEditorUrl, resolveDrawioFile, drawioHeaders } = require('../src/main/drawio-protocol');

function tempApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-drawio-'));
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'js', 'app.min.js'), '1');
  fs.writeFileSync(path.join(root, '..', `${path.basename(root)}-outside.txt`), 'x');
  return root;
}

test('serves files of the draw.io folder by URL path', async () => {
  const root = tempApp();
  assert.equal(await resolveDrawioFile(root, `${DRAWIO_ORIGIN}/index.html?embed=1&proto=json`), path.join(root, 'index.html'));
  assert.equal(await resolveDrawioFile(root, `${DRAWIO_ORIGIN}/js/app.min.js`), path.join(root, 'js', 'app.min.js'));
  assert.equal(await resolveDrawioFile(root, `${DRAWIO_ORIGIN}/`), path.join(root, 'index.html'));
});

test('refuses traversal, other hosts, folders and missing files', async () => {
  const root = tempApp();
  const sibling = `${path.basename(root)}-x`;
  for (const url of [
    `${DRAWIO_ORIGIN}/../${sibling}/a`,
    `${DRAWIO_ORIGIN}/%2e%2e/${path.basename(root)}-outside.txt`,
    `${DRAWIO_ORIGIN}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`,
    `${DRAWIO_ORIGIN}/js/..%2f..%2fetc`,
    `${DRAWIO_ORIGIN}/js%5c..%5c..%5cx`,
    `${DRAWIO_ORIGIN}/js`,
    `${DRAWIO_ORIGIN}/nada.js`,
    'docx-drawio://outro/index.html',
    'https://app/index.html',
    'not a url',
  ]) {
    assert.equal(await resolveDrawioFile(root, url), null, url);
  }
});

test('editor URL runs draw.io embedded, offline and in Portuguese', () => {
  const url = new URL(drawioEditorUrl({ dark: true }));
  assert.equal(`${url.protocol}//${url.host}`, DRAWIO_ORIGIN);
  for (const [key, value] of Object.entries({ embed: '1', proto: 'json', offline: '1', stealth: '1', lang: 'pt-br', ui: 'dark', math: '0', pwa: '0' })) {
    assert.equal(url.searchParams.get(key), value, key);
  }
  assert.equal(new URL(drawioEditorUrl({ dark: false })).searchParams.get('ui'), 'kennedy');
});

test('headers: type from the extension and a CSP that allows no other origin', () => {
  const html = drawioHeaders('/x/index.html');
  assert.equal(html['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(html['X-Content-Type-Options'], 'nosniff');
  const csp = html['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors file: 'self'/);
  assert.doesNotMatch(csp, /https?:|\*/);
  assert.equal(drawioHeaders('/x/a.js')['Content-Type'], 'text/javascript; charset=utf-8');
  assert.equal(drawioHeaders('/x/a.svg')['Content-Type'], 'image/svg+xml');
  assert.equal(drawioHeaders('/x/a.unknown')['Content-Type'], 'application/octet-stream');
});
