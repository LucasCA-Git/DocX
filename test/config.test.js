'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore, normalize, isGitConfigured } = require('../src/main/config');

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
