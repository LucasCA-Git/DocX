'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore, normalize, isGitConfigured, isS3Configured } = require('../src/main/config');

const base = { vaultPath: path.resolve('/notas') };

test('Git is the default sync and needs a URL', () => {
  const cfg = normalize(base);
  assert.equal(cfg.syncProvider, 'git');
  assert.equal(cfg.gitBranch, 'main');
  assert.equal(isGitConfigured(cfg), false);
  assert.equal(isGitConfigured(normalize({ ...base, gitUrl: 'git@github.com:lucas/notas.git' })), true);
  assert.equal(isS3Configured(normalize({ ...base, bucket: 'meu-bucket' })), false);
  assert.equal(isS3Configured(normalize({ ...base, syncProvider: 's3', bucket: 'meu-bucket' })), true);
});

test('rejects bad URLs, branches and providers', () => {
  assert.throws(() => normalize({ ...base, gitUrl: 'https://u:tok@github.com/a/b.git' }), /URL/);
  assert.throws(() => normalize({ ...base, syncProvider: 'ftp' }), /sincroniza/);
  for (const bad of ['-f', '../x', 'a..b', 'a.lock', 'a//b', 'x@{1}', '.hidden', 'a/', 'a b', 'a/.b']) {
    assert.throws(() => normalize({ ...base, gitBranch: bad }), /branch/, bad);
  }
  for (const ok of ['main', 'master', 'notas/pessoal', 'v1.0']) assert.equal(normalize({ ...base, gitBranch: ok }).gitBranch, ok);
});

test('configs saved before Git existed keep syncing with S3', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ vaultPath: base.vaultPath, bucket: 'docs3lucasalecrim', region: 'sa-east-1' }));
  const cfg = new ConfigStore(dir).load();
  assert.equal(cfg.syncProvider, 's3');
  assert.equal(isS3Configured(cfg), true);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ vaultPath: base.vaultPath }));
  assert.equal(new ConfigStore(dir).load().syncProvider, 'git');
});
