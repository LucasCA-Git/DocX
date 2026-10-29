'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateRemoteUrl, validateBranch } = require('./sync/git-sync');

const DEFAULTS = {
  vaultPath: '',
  // 'git' | 'none'.
  syncProvider: 'git',
  gitUrl: '',
  gitBranch: 'main',
  // Claude Code to run for the assistant: '' finds it, 'wsl' uses the one inside WSL, or a full path.
  claudeCommand: '',
};

const PROVIDERS = ['git', 'none'];
// Fields of the S3 sync, removed in 1.4: dropped from older configs.
const S3_FIELDS = ['bucket', 'prefix', 'region', 'profile'];

function normalize(input) {
  const pick = (key) => (typeof input?.[key] === 'string' ? input[key].trim() : DEFAULTS[key]);
  const cfg = {
    vaultPath: pick('vaultPath'),
    syncProvider: pick('syncProvider'),
    gitUrl: pick('gitUrl'),
    gitBranch: pick('gitBranch') || DEFAULTS.gitBranch,
    claudeCommand: pick('claudeCommand'),
  };
  if (cfg.vaultPath && !path.isAbsolute(cfg.vaultPath)) throw new Error('A pasta do vault precisa ser um caminho absoluto');
  if (!PROVIDERS.includes(cfg.syncProvider)) throw new Error('Tipo de sincronização inválido');
  if (cfg.gitUrl) validateRemoteUrl(cfg.gitUrl);
  validateBranch(cfg.gitBranch);
  // Only a Claude Code executable: the setting must not become a way to run any program.
  if (cfg.claudeCommand && cfg.claudeCommand !== 'wsl'
    && !(path.isAbsolute(cfg.claudeCommand) && /^claude(\.exe)?$/i.test(path.basename(cfg.claudeCommand)))) {
    throw new Error('O comando do Claude Code precisa ser "wsl" ou o caminho completo do executável claude');
  }
  return cfg;
}

const isGitConfigured = (cfg) => cfg.syncProvider === 'git' && Boolean(cfg.gitUrl);

// Stored in Electron's userData folder, outside the vault, so it is never synced.
class ConfigStore {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Configs that synced with S3 (by choice, or from before Git existed, with a bucket and no
      // provider) turn sync off: the user picks Git in the settings.
      const wasS3 = saved.syncProvider === 's3' || (!saved.syncProvider && saved.bucket);
      for (const key of S3_FIELDS) delete saved[key];
      if (wasS3) saved.syncProvider = 'none';
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

module.exports = { ConfigStore, isGitConfigured, normalize };
