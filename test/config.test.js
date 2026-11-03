'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ConfigStore, normalize, isGitConfigured, resolveVaultFolder,
} = require('../src/main/config');

const base = { vaultPath: path.resolve('/notas') };

test('Git is the default sync and needs a URL', () => {
  const cfg = normalize(base);
  assert.equal(cfg.syncProvider, 'git');
  assert.equal(cfg.gitBranch, 'main');
  assert.equal(isGitConfigured(cfg), false);
  assert.equal(isGitConfigured(normalize({ ...base, gitUrl: 'git@github.com:lucas/notas.git' })), true);
});

test('rejects bad URLs, branches and providers', () => {
  assert.throws(() => normalize({ ...base, gitUrl: 'https://u:tok@github.com/a/b.git' }), /URL/);
  assert.throws(() => normalize({ ...base, syncProvider: 'ftp' }), /sincroniza/);
  assert.throws(() => normalize({ ...base, syncProvider: 's3' }), /sincroniza/);
  for (const bad of ['-f', '../x', 'a..b', 'a.lock', 'a//b', 'x@{1}', '.hidden', 'a/', 'a b', 'a/.b']) {
    assert.throws(() => normalize({ ...base, gitBranch: bad }), /branch/, bad);
  }
  for (const ok of ['main', 'master', 'notas/pessoal', 'v1.0']) assert.equal(normalize({ ...base, gitBranch: ok }).gitBranch, ok);
});

test('S3 configs from older versions turn sync off and drop the S3 fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-cfg-'));
  const write = (cfg) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  write({ vaultPath: base.vaultPath, bucket: 'docs3lucasalecrim', region: 'sa-east-1' });
  let cfg = new ConfigStore(dir).load();
  assert.equal(cfg.syncProvider, 'none');
  assert.equal(cfg.vaultPath, base.vaultPath);
  for (const key of ['bucket', 'prefix', 'region', 'profile']) assert.equal(key in cfg, false, key);
  write({ vaultPath: base.vaultPath, syncProvider: 's3', bucket: 'x', gitUrl: 'git@github.com:a/b.git' });
  cfg = new ConfigStore(dir).load();
  assert.equal(cfg.syncProvider, 'none');
  assert.doesNotThrow(() => normalize(cfg));
  write({ vaultPath: base.vaultPath });
  assert.equal(new ConfigStore(dir).load().syncProvider, 'git');
});

test('claudeCommand accepts only "wsl" or a claude executable path', () => {
  const base = { vaultPath: path.resolve('/tmp/v'), syncProvider: 'none' };
  assert.equal(normalize({ ...base }).claudeCommand, '');
  assert.equal(normalize({ ...base, claudeCommand: 'wsl' }).claudeCommand, 'wsl');
  assert.equal(normalize({ ...base, claudeCommand: path.resolve('/opt/bin/claude') }).claudeCommand, path.resolve('/opt/bin/claude'));
  for (const bad of ['claude', path.resolve('/bin/sh'), path.resolve('/tmp/claude.sh'), path.resolve('/tmp/vault/evil.exe')]) {
    assert.throws(() => normalize({ ...base, claudeCommand: bad }), /Claude Code/, bad);
  }
});

const NOTAS = 'https://github.com/lucas/notas.git';
const PROJETO = 'https://github.com/lucas/projeto.git';
const docs = path.resolve('/docs/notas-pessoais');
const git = (gitUrl, vaultPath = docs, extra = {}) => ({ ...normalize({ vaultPath, gitUrl }), ...extra });

test('another repository in the same folder gets a folder of its own, named after it', () => {
  const next = resolveVaultFolder(git(NOTAS), git(PROJETO), () => 'missing');
  assert.equal(next.vaultPath, path.resolve('/docs/projeto'));
  assert.equal(next.repoFolders[NOTAS], docs);
  assert.equal(next.repoFolders[PROJETO], path.resolve('/docs/projeto'));
});

test('switching back reopens the folder each repository had', () => {
  const first = resolveVaultFolder(git(NOTAS), git(PROJETO), () => 'missing');
  const back = resolveVaultFolder(first, { ...first, gitUrl: NOTAS }, () => 'used');
  assert.equal(back.vaultPath, docs);
  const again = resolveVaultFolder(back, { ...back, gitUrl: 'https://github.com/lucas/projeto' }, () => 'used');
  assert.equal(again.vaultPath, path.resolve('/docs/projeto'));
});

test('a new folder never lands on one already in use', () => {
  const used = new Set([path.resolve('/docs/projeto'), path.resolve('/docs/projeto (2)')]);
  const next = resolveVaultFolder(git(NOTAS), git(PROJETO), (dir) => (used.has(dir) ? 'used' : 'missing'));
  assert.equal(next.vaultPath, path.resolve('/docs/projeto (3)'));
  const empty = resolveVaultFolder(git(NOTAS), git(PROJETO), () => 'empty');
  assert.equal(empty.vaultPath, path.resolve('/docs/projeto'));
});

test('the folder stays when the user picks one, the URL is the same or there was no repository', () => {
  const chosen = path.resolve('/outra/pasta');
  assert.equal(resolveVaultFolder(git(NOTAS), git(PROJETO, chosen), () => 'used').vaultPath, chosen);
  assert.equal(resolveVaultFolder(git(NOTAS), git(NOTAS.slice(0, -4)), () => 'used').vaultPath, docs);
  assert.equal(resolveVaultFolder(git(''), git(PROJETO), () => 'used').vaultPath, docs);
  const off = { ...git(PROJETO), syncProvider: 'none' };
  assert.equal(resolveVaultFolder(git(NOTAS), off, () => 'used').vaultPath, docs);
});

test('repoFolders survive a save and drop bad entries', () => {
  const cfg = normalize({ vaultPath: docs, repoFolders: { [NOTAS]: docs, x: 'relativo', '': docs, y: 3 } });
  assert.deepEqual(cfg.repoFolders, { [NOTAS]: docs });
});
