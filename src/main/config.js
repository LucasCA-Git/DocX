'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateRemoteUrl, validateBranch } = require('./sync/git-sync');

const DEFAULTS = {
  vaultPath: '',
  // 'git' | 's3' | 'none'. Configs saved before Git existed have no provider: they were S3.
  syncProvider: 'git',
  gitUrl: '',
  gitBranch: 'main',
  bucket: '',
  prefix: '',
  region: 'us-east-1',
  profile: 'default',
};

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;
const PROVIDERS = ['git', 's3', 'none'];

function normalize(input) {
  const pick = (key) => (typeof input?.[key] === 'string' ? input[key].trim() : DEFAULTS[key]);
  const cfg = {
    vaultPath: pick('vaultPath'),
    syncProvider: pick('syncProvider'),
    gitUrl: pick('gitUrl'),
    gitBranch: pick('gitBranch') || DEFAULTS.gitBranch,
    bucket: pick('bucket'),
    prefix: pick('prefix').replace(/^\/+|\/+$/g, ''),
    region: pick('region') || DEFAULTS.region,
    profile: pick('profile'),
  };
  if (cfg.vaultPath && !path.isAbsolute(cfg.vaultPath)) throw new Error('A pasta do vault precisa ser um caminho absoluto');
  if (!PROVIDERS.includes(cfg.syncProvider)) throw new Error('Tipo de sincronização inválido');
  if (cfg.gitUrl) validateRemoteUrl(cfg.gitUrl);
  validateBranch(cfg.gitBranch);
  if (cfg.bucket && !BUCKET_RE.test(cfg.bucket)) throw new Error('Nome de bucket inválido');
  if (!REGION_RE.test(cfg.region)) throw new Error('Região AWS inválida (ex.: us-east-1, sa-east-1)');
  return cfg;
}

const isS3Configured = (cfg) => cfg.syncProvider === 's3' && Boolean(cfg.bucket && cfg.region);
const isGitConfigured = (cfg) => cfg.syncProvider === 'git' && Boolean(cfg.gitUrl);

// Stored in Electron's userData folder, outside the vault, so it is never synced.
class ConfigStore {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!saved.syncProvider) saved.syncProvider = saved.bucket ? 's3' : DEFAULTS.syncProvider;
      return { ...DEFAULTS, ...saved };
    } catch {
      return { ...DEFAULTS };
    }
  }

  save(input) {
    const cfg = normalize(input);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(cfg, null, 2));
    return cfg;
  }
}

module.exports = { ConfigStore, isS3Configured, isGitConfigured, normalize };
