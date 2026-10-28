'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Vault } = require('../src/main/vault');

async function tempVault() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-vault-'));
  return new Vault(dir);
}

test('listTree returns files and folders, including empty folders', async () => {
  const vault = await tempVault();
  await vault.write('Deploy/Front.md', 'a');
  await vault.write('Nota.md', 'b');
  await fs.mkdir(path.join(vault.root, 'Vazia'));
  await fs.mkdir(path.join(vault.root, '.config'));
  assert.deepEqual(await vault.listTree(), { files: ['Deploy/Front.md', 'Nota.md'], folders: ['Deploy', 'Vazia'] });
});

test('mkdir creates nested folders and rejects existing ones', async () => {
  const vault = await tempVault();
  await vault.mkdir('Projetos/Docs');
  assert.deepEqual((await vault.listTree()).folders, ['Projetos', 'Projetos/Docs']);
  await assert.rejects(vault.mkdir('Projetos'), /já existe/);
});

test('mkdir refuses paths outside the vault', async () => {
  const vault = await tempVault();
  await assert.rejects(vault.mkdir('../fora'), /fora do vault/);
});

test('rename that only changes letter case works', async () => {
  const vault = await tempVault();
  await vault.write('nota.md', 'x');
  await vault.rename('nota.md', 'Nota.md');
  assert.deepEqual((await vault.listTree()).files, ['Nota.md']);
});

test('names starting with a dot are rejected (they would be hidden and never synced)', async () => {
  const vault = await tempVault();
  await vault.write('a.md', 'x');
  await assert.rejects(vault.rename('a.md', '.a.md'), /começar com "\."/);
  await assert.rejects(vault.create('pasta/.oculta.md'), /começar com "\."/);
  await assert.rejects(vault.mkdir('.pasta'), /começar com "\."/);
});

test('readTexts returns each file as text, null for missing or unreadable ones', async () => {
  const vault = await tempVault();
  await vault.write('A.md', 'a [[B]]');
  await vault.write('Pasta/B.md', 'b');
  assert.deepEqual(await vault.readTexts(['A.md', 'Pasta/B.md', 'Nada.md', '../fora.md']), ['a [[B]]', 'b', null, null]);
});

test('readTexts only reads notes and skips files above the size limit', async () => {
  const vault = await tempVault();
  await vault.write('A.md', 'a');
  await vault.write('img.png', 'binary');
  await vault.write('Grande.md', 'x'.repeat(100));
  assert.deepEqual(await vault.readTexts(['A.md', 'img.png', 'Grande.md'], { maxBytes: 50 }), ['a', null, null]);
});

test('readTexts also reads canvases, drawings and diagrams (their links are indexed)', async () => {
  const vault = await tempVault();
  for (const rel of ['M.canvas', 'D.excalidraw', 'F.drawio', 'F.drawio.svg', 'foto.svg']) await vault.write(rel, rel);
  assert.deepEqual(await vault.readTexts(['M.canvas', 'D.excalidraw', 'F.drawio', 'F.drawio.svg', 'foto.svg']), ['M.canvas', 'D.excalidraw', 'F.drawio', 'F.drawio.svg', null]);
});

test('listTree with times gives modified and created times per file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-vault-'));
  const vault = new Vault(root);
  await vault.write('a.md', 'x');
  const tree = await vault.listTree({ withTimes: true });
  assert.deepEqual(tree.files, ['a.md']);
  const [mtime, ctime] = tree.times['a.md'];
  assert.ok(mtime > Date.now() - 60_000 && ctime > 0);
  assert.equal((await vault.listTree()).times, undefined);
});

test('copy duplicates a file and refuses to overwrite', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-vault-'));
  const vault = new Vault(root);
  await vault.write('a.png', Buffer.from([1, 2, 3]));
  await vault.copy('a.png', 'pasta/b.png');
  assert.deepEqual([...await vault.read('pasta/b.png')], [1, 2, 3]);
  await assert.rejects(vault.copy('a.png', 'pasta/b.png'), /já existe/);
  await assert.rejects(vault.copy('a.png', '.oculto.png'), /"\."/);
});
