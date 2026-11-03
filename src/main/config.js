'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validateRemoteUrl, validateBranch, sameRemote, repoName,
} = require('./sync/git-sync');

const DEFAULTS = {
  vaultPath: '',
  // 'git' | 'none'.
  syncProvider: 'git',
  gitUrl: '',
  gitBranch: 'main',
  // Claude Code to run for the assistant: '' finds it, 'wsl' uses the one inside WSL, or a full path.
  claudeCommand: '',
  // Folder of each repository used so far (remote URL → vault folder), so switching repositories
  // switches folders too and switching back reopens the old one.
  repoFolders: {},
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
    repoFolders: Object.fromEntries(Object.entries(input?.repoFolders ?? {})
      .filter(([url, dir]) => typeof url === 'string' && url && typeof dir === 'string' && path.isAbsolute(dir))),
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

const samePath = (a, b) => {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

// What is in a folder: 'missing', 'empty' or 'used'.
function inspectFolder(dir) {
  try {
    return fs.readdirSync(dir).length ? 'used' : 'empty';
  } catch {
    return 'missing';
  }
}

// A vault folder belongs to one repository. When the settings change the Git URL but keep the
// folder, the new repository gets its own folder: the one it had before, or a new one next to the
// current folder named after the repository ("Documents/projeto" for …/projeto.git), never one
// already in use. Without this the old notes would be merged into the new repository.
function resolveVaultFolder(prev, next, inspect = inspectFolder) {
  const repoFolders = { ...prev.repoFolders, ...next.repoFolders };
  const known = (url) => Object.entries(repoFolders).find(([u]) => sameRemote(u, url))?.[1];
  const remember = (url, dir) => {
    for (const u of Object.keys(repoFolders)) if (sameRemote(u, url)) delete repoFolders[u];
    repoFolders[url] = dir;
  };
  if (prev.gitUrl && prev.vaultPath) remember(prev.gitUrl, prev.vaultPath);
  let { vaultPath } = next;
  const switched = isGitConfigured(next) && prev.gitUrl && !sameRemote(prev.gitUrl, next.gitUrl)
    && vaultPath && prev.vaultPath && samePath(vaultPath, prev.vaultPath);
  if (switched) {
    vaultPath = known(next.gitUrl);
    if (!vaultPath) {
      const base = path.join(path.dirname(prev.vaultPath), repoName(next.gitUrl));
      for (let i = 1; !vaultPath; i++) {
        const candidate = i === 1 ? base : `${base} (${i})`;
        if (inspect(candidate) !== 'used') vaultPath = candidate;
      }
    }
  }
  if (isGitConfigured(next) && vaultPath) remember(next.gitUrl, vaultPath);
  return { ...next, vaultPath, repoFolders };
}

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

module.exports = {
  ConfigStore, isGitConfigured, normalize, resolveVaultFolder,
};
