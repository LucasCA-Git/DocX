'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Vault } = require('../src/main/vault');
const { SyncEngine, conflictName } = require('../src/main/sync/engine');
const { SyncState } = require('../src/main/sync/state');
const { PreconditionFailed } = require('../src/main/sync/errors');
const { MemoryRemote } = require('./memory-remote');

// One "device": its own local folder and sync state, sharing the remote with other devices.
async function device(remote) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-vault-'));
  const vault = new Vault(root);
  const state = await SyncState.load(path.join(root, '.docs-sync', 'state.json'), 'bucket/notas');
  const engine = new SyncEngine({ vault, remote, state });
  const write = (rel, text) => vault.write(rel, text);
  const read = async (rel) => (await vault.read(rel)).toString('utf8');
  const exists = async (rel) => (await vault.fileInfo(rel)) !== null;
  return { root, vault, engine, write, read, exists };
}

test('uploads new notes and restores them into an empty folder', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  await a.write('ideias.md', '# Ideias');
  await a.write('projetos/s3.md', 'sync com s3');
  await a.engine.syncAll();

  assert.equal(remote.text('ideias.md'), '# Ideias');
  assert.equal(remote.text('projetos/s3.md'), 'sync com s3');

  const restored = await device(remote);
  await restored.engine.syncAll();
  assert.equal(await restored.read('ideias.md'), '# Ideias');
  assert.equal(await restored.read('projetos/s3.md'), 'sync com s3');
});

test('never syncs dotfiles, trash or sync state', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  await a.write('nota.md', 'x');
  await a.write('.secreto', 'y');
  await a.engine.syncAll();
  assert.deepEqual([...remote.objects.keys()], ['nota.md']);
});

test('local edits upload and reach the other device', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  const b = await device(remote);
  await a.write('nota.md', 'v1');
  await a.engine.syncAll();
  await b.engine.syncAll();

  await a.write('nota.md', 'v2 editada');
  await a.engine.syncFile('nota.md');
  assert.equal(remote.text('nota.md'), 'v2 editada');

  await b.engine.syncAll();
  assert.equal(await b.read('nota.md'), 'v2 editada');
});

test('a second sync with no changes does nothing', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  await a.write('nota.md', 'v1');
  await a.engine.syncAll();
  const etag = remote.objects.get('nota.md').etag;
  const changed = await a.engine.syncAll();
  assert.deepEqual(changed, []);
  assert.equal(remote.objects.get('nota.md').etag, etag);
});

test('local delete removes the remote copy; the other device moves it to .trash', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  const b = await device(remote);
  await a.write('velha.md', 'apagar');
  await a.engine.syncAll();
  await b.engine.syncAll();

  await a.vault.trash('velha.md');
  await a.engine.syncAll();
  assert.equal(remote.objects.has('velha.md'), false);

  await b.engine.syncAll();
  assert.equal(await b.exists('velha.md'), false);
  assert.equal(await fs.readFile(path.join(b.root, '.trash', 'velha.md'), 'utf8'), 'apagar');
});

test('a note edited on one device is restored instead of deleted by the other', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  const b = await device(remote);
  await a.write('nota.md', 'v1');
  await a.engine.syncAll();
  await b.engine.syncAll();

  await a.vault.trash('nota.md');
  await b.write('nota.md', 'v2 de b');
  await b.engine.syncAll();
  await a.engine.syncAll();

  assert.equal(await a.read('nota.md'), 'v2 de b');
  assert.equal(remote.text('nota.md'), 'v2 de b');
});

test('concurrent edits keep both versions as a conflict copy', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  const b = await device(remote);
  await a.write('nota.md', 'base');
  await a.engine.syncAll();
  await b.engine.syncAll();

  await a.write('nota.md', 'versão A');
  await a.engine.syncAll();
  await b.write('nota.md', 'versão B');
  const conflicts = [];
  b.engine.on('conflict', (c) => conflicts.push(c));
  await b.engine.syncAll();

  assert.equal(conflicts.length, 1);
  const { copy } = conflicts[0];
  assert.match(copy, /^nota \(conflito \d{4}-\d{2}-\d{2} \d{6}\)\.md$/);
  assert.equal(await b.read('nota.md'), 'versão B');
  assert.equal(await b.read(copy), 'versão A');
  assert.equal(remote.text('nota.md'), 'versão B');
  assert.equal(remote.text(copy), 'versão A');

  await a.engine.syncAll();
  assert.equal(await a.read('nota.md'), 'versão B');
  assert.equal(await a.read(copy), 'versão A');
});

test('identical content on both sides without history is not a conflict', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  const b = await device(remote);
  await a.write('nota.md', 'igual');
  await a.engine.syncAll();
  await b.write('nota.md', 'igual');
  const conflicts = [];
  b.engine.on('conflict', (c) => conflicts.push(c));
  await b.engine.syncAll();
  assert.equal(conflicts.length, 0);
  assert.deepEqual((await b.vault.walk()), ['nota.md']);
});

test('retries once when S3 rejects a stale conditional write', async () => {
  const remote = new MemoryRemote();
  const a = await device(remote);
  await a.write('nota.md', 'v1');
  await a.engine.syncAll();

  // Another device writes right after our HEAD, so our If-Match is stale.
  await a.write('nota.md', 'v2 local');
  const originalPut = remote.put.bind(remote);
  let raced = false;
  remote.put = async (key, body, cond) => {
    if (!raced) {
      raced = true;
      await originalPut(key, Buffer.from('v2 remota'));
      throw new PreconditionFailed(key);
    }
    return originalPut(key, body, cond);
  };
  await a.engine.syncFile('nota.md');

  const files = await a.vault.walk();
  const copy = files.find((f) => f.includes('conflito'));
  assert.ok(copy, 'remote version kept as a conflict copy');
  assert.equal(await a.read(copy), 'v2 remota');
  assert.equal(remote.text('nota.md'), 'v2 local');
});

test('state is per bucket/prefix', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-state-'));
  const file = path.join(root, 'state.json');
  const state = await SyncState.load(file, 'bucket-a/');
  state.files['x.md'] = { hash: 'h', etag: 'e' };
  await state.save();
  assert.deepEqual((await SyncState.load(file, 'bucket-a/')).files, { 'x.md': { hash: 'h', etag: 'e' } });
  assert.deepEqual((await SyncState.load(file, 'bucket-b/')).files, {});
});

test('vault rejects paths outside its folder', async () => {
  const { vault } = await device(new MemoryRemote());
  assert.throws(() => vault.resolve('../fora.md'), /fora do vault/);
  assert.throws(() => vault.resolve(''), /inválido/);
});

test('conflictName keeps the extension', () => {
  const name = conflictName('pasta/nota.md', new Date(2026, 9, 21, 15, 30, 5));
  assert.equal(name, 'pasta/nota (conflito 2026-10-21 153005).md');
});
