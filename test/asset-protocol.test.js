'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Vault } = require('../src/main/vault');
const { resolveAsset, assetHeaders } = require('../src/main/asset-protocol');
const { assetUrl } = require('../src/shared/asset-url');

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-asset-'));
  const vault = new Vault(path.join(dir, 'vault'));
  await vault.write('Imagens/Terminus SFTP.png', 'png');
  await vault.write('Nota.md', '# nota');
  await vault.write('.trash/old.png', 'png');
  await fs.writeFile(path.join(dir, 'secret.png'), 'outside');
  return { dir, vault };
}

test('resolveAsset serves an image inside the vault', async () => {
  const { vault } = await setup();
  const full = await resolveAsset(vault, assetUrl('Imagens/Terminus SFTP.png'));
  assert.equal(await fs.readFile(full, 'utf8'), 'png');
});

test('resolveAsset refuses non-images, hidden folders, missing files and traversal', async () => {
  const { vault } = await setup();
  assert.equal(await resolveAsset(vault, assetUrl('Nota.md')), null);
  assert.equal(await resolveAsset(vault, assetUrl('.trash/old.png')), null);
  assert.equal(await resolveAsset(vault, assetUrl('Nada.png')), null);
  assert.equal(await resolveAsset(vault, assetUrl('../secret.png')), null);
  assert.equal(await resolveAsset(vault, 'vault-asset://local/..%2Fsecret.png'), null);
  assert.equal(await resolveAsset(null, assetUrl('Imagens/Terminus SFTP.png')), null);
});

test('resolveAsset refuses a link inside the vault that points outside it', async (t) => {
  const { dir, vault } = await setup();
  try {
    await fs.symlink(path.join(dir, 'secret.png'), path.join(vault.root, 'link.png'));
  } catch {
    t.skip('symlinks not available');
    return;
  }
  assert.equal(await resolveAsset(vault, assetUrl('link.png')), null);
});

// On Windows ".trash" is also reachable as "TRASH~1"; the check must look at the real path.
test('resolveAsset refuses a visible name whose real path is in a hidden folder', async (t) => {
  const { vault } = await setup();
  try {
    await fs.symlink(path.join(vault.root, '.trash'), path.join(vault.root, 'TRASH~1'), 'junction');
  } catch {
    t.skip('symlinks not available');
    return;
  }
  assert.equal(await resolveAsset(vault, assetUrl('TRASH~1/old.png')), null);
});

test('assetHeaders sets an explicit type and locks SVG down', () => {
  assert.equal(assetHeaders('a/b.PNG')['Content-Type'], 'image/png');
  assert.equal(assetHeaders('x.jpg')['Content-Type'], 'image/jpeg');
  const svg = assetHeaders('x.svg');
  assert.equal(svg['Content-Type'], 'image/svg+xml');
  assert.equal(svg['X-Content-Type-Options'], 'nosniff');
  assert.match(svg['Content-Security-Policy'], /default-src 'none'.*sandbox/);
});

test('resolveAsset also serves audio and video, with their types', async () => {
  const { vault } = await setup();
  await vault.write('som.mp3', 'mp3');
  const full = await resolveAsset(vault, assetUrl('som.mp3'));
  assert.equal(assetHeaders(full)['Content-Type'], 'audio/mpeg');
  await vault.write('nota.md', 'x');
  assert.equal(await resolveAsset(vault, assetUrl('nota.md')), null);
});

test('parseRange handles the byte ranges media players ask for', () => {
  const { parseRange } = require('../src/main/asset-protocol');
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.equal(parseRange('bytes=2000-', 1000), 'invalid');
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null);
});

test('a reversed range is ignored (whole file), not refused', () => {
  const { parseRange } = require('../src/main/asset-protocol');
  assert.equal(parseRange('bytes=5-2', 1000), null);
});
