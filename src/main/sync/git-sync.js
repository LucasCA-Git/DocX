'use strict';

const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { conflictName } = require('./engine');

const NETWORK_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 60_000;
const MAX_ROUNDS = 3;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
// After a login failure the timer stops retrying for a while (a wrong password retried every 30 s
// can lock the account); "sincronizar agora" still tries at once.
const AUTH_BACKOFF_MS = 10 * 60_000;

// Mirrors vault.isIgnored: dotfiles/dot-folders (.trash, .docs-sync, temp files) and node_modules.
const EXCLUDE = ['# Docs: nunca versionar', '.*', 'node_modules/', ''].join('\n');
// Highest-precedence attributes: no clean/smudge filter from an in-tree .gitattributes ever runs,
// and content is stored byte for byte.
const ATTRIBUTES = ['# Docs', '* -filter -text', ''].join('\n');

// Repo-local config keys the app accepts. Anything else in a pre-existing .git/config (fsmonitor,
// sshCommand, credential helpers, filters, aliases, include, insteadOf…) could run a program or
// send the notes elsewhere, so such a repository is refused.
const SAFE_CONFIG_RE = new RegExp([
  '^core\\.(repositoryformatversion|filemode|bare|logallrefupdates|autocrlf|safecrlf|ignorecase|symlinks|precomposeunicode)$',
  '^user\\.(name|email)$',
  '^remote\\.origin\\.(url|fetch)$',
  '^branch\\.[^\\s]+\\.(remote|merge)$',
  '^extensions\\.objectformat$',
  '^gc\\.[a-z]+$',
].join('|'));

const HOST = '[A-Za-z0-9][A-Za-z0-9.-]*';
const SEGMENT = '(?!\\.\\.?(?:/|$))[A-Za-z0-9._~+-]+';
const REPO_PATH = `(?!-)${SEGMENT}(?:/${SEGMENT})*`;
const USER = '[A-Za-z0-9_][A-Za-z0-9._-]*';
const URL_RES = [
  new RegExp(`^https://${HOST}(:\\d{1,5})?/${REPO_PATH}$`),
  new RegExp(`^ssh://(${USER}@)?${HOST}(:\\d{1,5})?/${REPO_PATH}$`),
  new RegExp(`^${USER}@${HOST}:${REPO_PATH}$`),
];

// Only https and ssh remotes, never with a user/token inside the URL (credentials belong to the
// Git Credential Manager or the SSH agent). Anything that could be read as an option is refused.
function validateRemoteUrl(url) {
  if (typeof url !== 'string' || !URL_RES.some((re) => re.test(url))) {
    throw new Error('URL do repositório inválida: use https://host/usuario/repo.git ou git@host:usuario/repo.git, sem usuário/senha na URL');
  }
  return url;
}

// A narrow subset of git check-ref-format: it ends up in refspecs and command lines.
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*[./]$)(?!\/)[A-Za-z0-9._/-]{1,100}$/;
function validateBranch(branch) {
  if (typeof branch !== 'string'
    || !BRANCH_RE.test(branch)
    || branch.split('/').some((seg) => seg.startsWith('.') || seg.endsWith('.lock'))
    || /^(HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD)$/i.test(branch)) {
    throw new Error('Nome de branch inválido');
  }
  return branch;
}

const redact = (text) => text
  .replace(/((?:https?|ssh):\/\/)[^\s'"/@]+@/gi, '$1***@')
  .replace(/\b(gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]+/g, '$1***')
  .replace(/[\u0000-\u001f\u007f]/g, ' ');

function describeGitError(stderr) {
  const text = String(stderr ?? '').trim();
  if (/Authentication failed|could not read Username|terminal prompts disabled|HTTP Basic: Access denied|returned error: 403|\b403 Forbidden/i.test(text)) {
    return 'Falha de autenticação no Git: faça login no repositório (Git Credential Manager) e tente de novo';
  }
  if (/Permission denied \(publickey|Host key verification failed/i.test(text)) {
    return 'O servidor recusou a chave SSH: confira sua chave (ssh-agent) ou use a URL https';
  }
  if (/repository .* not found|Repository not found|does not appear to be a git repository/i.test(text)) {
    return 'Repositório não encontrado: confira a URL e se você tem acesso a ele';
  }
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable|Failed to connect|Could not read from remote/i.test(text)) {
    return 'Sem conexão com o repositório: as notas ficam salvas aqui e vão quando a rede voltar';
  }
  const line = text.split('\n').filter(Boolean).pop() ?? 'erro desconhecido';
  return `Git: ${redact(line.replace(/^(fatal|error):\s*/, '')).slice(0, 300)}`;
}

const isAuthError = (message) => /autenticação|chave SSH/.test(message);

class GitError extends Error {
  constructor(command, code, stderr) {
    super(describeGitError(stderr));
    this.name = 'GitError';
    this.command = command;
    this.code = code;
    this.stderr = String(stderr);
  }
}

// Absolute path of git. On Windows a bare "git" would also be looked up in the working directory —
// the vault — so a git.exe that arrived with the notes would run instead of the real one.
function findGit({ platform = process.platform, envPath = process.env.PATH ?? '' } = {}) {
  if (platform !== 'win32') return 'git';
  const dirs = envPath.split(';').filter((d) => d && path.win32.isAbsolute(d));
  dirs.push('C:\\Program Files\\Git\\cmd', 'C:\\Program Files (x86)\\Git\\cmd');
  for (const dir of dirs) {
    const candidate = path.win32.join(dir, 'git.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    child.kill('SIGKILL');
  }
}

// GIT_* variables of the environment the app was started from (GIT_SSH_COMMAND, GIT_DIR,
// GIT_CONFIG_PARAMETERS…) must not change what git does here.
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  return env;
}

const splitZ = (buf) => buf.toString('utf8').split('\0').filter(Boolean);

// Sync through a Git remote: the vault folder is the working tree. Every round commits what changed
// here, merges what came from the remote and pushes. Like the S3 engine nothing is silently lost:
// when both sides changed a file the remote version is kept next to ours as a "(conflito …)" copy.
//
// Same events as SyncEngine: 'status', 'local-changed' [paths], 'conflict' {path, copy}.
class GitSync extends EventEmitter {
  // hooksDir: an empty folder owned by the app (git never runs hooks from the vault's .git).
  // allowFile: tests only (local bare repositories); skips URL validation.
  constructor({ vault, url, branch = 'main', hooksDir, allowFile = false, env = {}, hostname = os.hostname(), git = findGit() }) {
    super();
    if (!git) throw new Error('Git não encontrado: instale o Git for Windows (git-scm.com)');
    this.vault = vault;
    this.url = allowFile ? url : validateRemoteUrl(url);
    this.branch = validateBranch(branch);
    this.hooksDir = hooksDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'docs-no-hooks-'));
    this.allowFile = allowFile;
    this.env = env;
    this.hostname = hostname.replace(/[^A-Za-z0-9.-]/g, '') || 'docs';
    this.gitBin = git;
    this.queue = Promise.resolve();
    this.pending = null;
    this.authBlockedUntil = 0;
  }

  get gitDir() {
    return path.join(this.vault.root, '.git');
  }

  get remoteRef() {
    return `refs/remotes/origin/${this.branch}`;
  }

  async hasRepo() {
    try {
      await fsp.access(path.join(this.gitDir, 'HEAD'));
      return true;
    } catch {
      return false;
    }
  }

  // Every path is part of the next round anyway: the main process can treat all of them as known.
  hasBase() {
    return true;
  }

  syncFile() {
    return this.syncAll();
  }

  // Requests arriving while a round is waiting to start join that round. Timer rounds (`force`
  // false) pause for a while after a login failure.
  syncAll({ force = true } = {}) {
    if (!force && Date.now() < this.authBlockedUntil) return Promise.reject(new Error(this.authMessage));
    if (this.pending) return this.pending;
    const run = this.queue.then(() => {
      this.pending = null;
      return this.track(() => this.round());
    });
    this.pending = run;
    this.queue = run.catch(() => {});
    return run;
  }

  async track(fn) {
    this.emit('status', { state: 'syncing' });
    try {
      const result = await fn();
      this.authBlockedUntil = 0;
      this.emit('status', { state: 'idle', at: Date.now() });
      return result;
    } catch (err) {
      if (isAuthError(err.message)) {
        this.authBlockedUntil = Date.now() + AUTH_BACKOFF_MS;
        this.authMessage = err.message;
      }
      this.emit('status', { state: 'error', message: err.message });
      throw err;
    }
  }

  // ---------- git process ----------

  run(args, { network = false, okCodes = [0] } = {}) {
    const config = [
      '-c', 'core.quotepath=false',
      '-c', `core.hooksPath=${this.hooksDir}`,
      '-c', 'core.fsmonitor=false',
      '-c', 'core.symlinks=false',
      '-c', 'core.protectNTFS=true',
      '-c', 'core.protectHFS=true',
      '-c', 'fetch.fsckObjects=true',
      '-c', 'transfer.fsckObjects=true',
      '-c', 'protocol.allow=never',
      '-c', 'protocol.https.allow=always',
      '-c', 'protocol.ssh.allow=always',
      ...(this.allowFile ? ['-c', 'protocol.file.allow=always'] : []),
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitBin, [...config, ...args], {
        cwd: this.vault.root,
        // GIT_DIR pins the repository to <vault>/.git: never a parent repository found by walking up.
        // Literal pathspecs: a file named ":(exclude)x" is just a file name.
        env: {
          ...cleanEnv(),
          LC_ALL: 'C',
          LANGUAGE: 'C',
          GIT_DIR: this.gitDir,
          GIT_WORK_TREE: this.vault.root,
          GIT_LITERAL_PATHSPECS: '1',
          ...this.env,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out = [];
      const err = [];
      let size = 0;
      let failure = null;
      const stop = (reason) => {
        failure ??= reason;
        killTree(child);
      };
      const timer = setTimeout(() => stop(`fatal: git ${args[0]} demorou demais e foi interrompido`), network ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS);
      const collect = (into) => (data) => {
        size += data.length;
        if (size > MAX_OUTPUT_BYTES) stop(`fatal: git ${args[0]} devolveu dados demais`);
        else into.push(data);
      };
      child.stdout.on('data', collect(out));
      child.stderr.on('data', collect(err));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e.code === 'ENOENT' ? new Error('Git não encontrado: instale o Git for Windows (git-scm.com)') : e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const stderr = Buffer.concat(err).toString('utf8');
        if (failure) reject(new GitError(args[0], null, failure));
        else if (!okCodes.includes(code)) reject(new GitError(args[0], code, stderr));
        else resolve({ code, stdout: Buffer.concat(out), stderr });
      });
    });
  }

  async revParse(ref) {
    const { code, stdout } = await this.run(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { okCodes: [0, 1] });
    return code === 0 ? stdout.toString().trim() : null;
  }

  // ---------- one round ----------

  async round() {
    await this.ensureRepo();
    await this.commitLocal();
    for (let i = 0; i < MAX_ROUNDS; i++) {
      await this.run(['fetch', '--no-tags', '--prune', 'origin'], { network: true });
      await this.mergeRemote();
      if (!(await this.needsPush())) return;
      try {
        await this.run(['push', '--no-verify', 'origin', `HEAD:refs/heads/${this.branch}`], { network: true });
        return;
      } catch (err) {
        // Someone pushed between our fetch and our push: fetch, merge and try again.
        if (!(err instanceof GitError) || !/rejected|non-fast-forward|fetch first/i.test(err.stderr)) throw err;
      }
    }
    throw new Error('Git: o remoto mudou várias vezes durante o envio; tente de novo');
  }

  async ensureRepo() {
    const fresh = !(await this.hasRepo());
    if (fresh) {
      await this.run(['init', '-q']);
      await this.run(['symbolic-ref', 'HEAD', `refs/heads/${this.branch}`]);
      // Byte-for-byte content on every machine, whatever the global autocrlf says.
      await this.run(['config', 'core.autocrlf', 'false']);
      await this.run(['config', 'core.safecrlf', 'false']);
    } else {
      await this.auditConfig();
    }
    const info = path.join(this.gitDir, 'info');
    await fsp.mkdir(info, { recursive: true });
    for (const [file, block] of [['exclude', EXCLUDE], ['attributes', ATTRIBUTES]]) {
      const full = path.join(info, file);
      const current = await fsp.readFile(full, 'utf8').catch(() => '');
      if (!current.includes(block)) await fsp.writeFile(full, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${block}`);
    }
    const { code, stdout } = await this.run(['remote', 'get-url', 'origin'], { okCodes: [0, 2] });
    if (code !== 0) await this.run(['remote', 'add', 'origin', '--', this.url]);
    else if (stdout.toString().trim() !== this.url) await this.run(['remote', 'set-url', 'origin', '--', this.url]);
    for (const [key, value] of [['user.name', 'Docs'], ['user.email', `docs@${this.hostname}`]]) {
      const res = await this.run(['config', '--get', key], { okCodes: [0, 1] });
      if (res.code !== 0) await this.run(['config', key, value]);
    }
  }

  async auditConfig() {
    const { stdout } = await this.run(['config', '--local', '--no-includes', '--list', '-z']);
    for (const entry of splitZ(stdout)) {
      const key = entry.split('\n')[0].toLowerCase();
      if (!SAFE_CONFIG_RE.test(key)) {
        throw new Error(`A pasta já tem um repositório Git com uma configuração que o app não aceita (${key}). Remova essa configuração ou use outra pasta.`);
      }
    }
  }

  message() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `vault: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (${this.hostname})`;
  }

  // An empty folder has nothing to commit and no HEAD yet; it just takes the remote in mergeRemote.
  async commitLocal() {
    await this.run(['add', '-A']);
    const { code } = await this.run(['diff', '--cached', '--quiet'], { okCodes: [0, 1] });
    if (code === 0) return false;
    await this.run(['commit', '-q', '--no-verify', '-m', this.message()]);
    return true;
  }

  // The app's own sync state never comes from a remote.
  async checkRemoteTree() {
    const { stdout } = await this.run(['ls-tree', '-r', '-z', '--name-only', this.remoteRef]);
    if (splitZ(stdout).some((rel) => rel.split('/')[0] === '.docs-sync')) {
      throw new Error('O repositório remoto contém a pasta .docs-sync, reservada ao app; remova-a do repositório');
    }
  }

  async mergeRemote() {
    const theirs = await this.revParse(this.remoteRef);
    if (!theirs) return;
    const before = await this.revParse('HEAD');
    if (before === theirs) return;
    await this.checkRemoteTree();
    if (!before) {
      await this.run(['checkout', '-q', '-B', this.branch, this.remoteRef, '--']);
      this.emitChanged(splitZ((await this.run(['ls-tree', '-r', '-z', '--name-only', 'HEAD'])).stdout));
      return;
    }
    const merge = await this.run(
      ['merge', '-q', '--no-verify', '--no-edit', '--allow-unrelated-histories', '-m', `${this.message()} merge`, this.remoteRef],
      { okCodes: [0, 1] },
    );
    if (merge.code !== 0) await this.resolveConflicts();
    const after = await this.revParse('HEAD');
    if (after !== before) {
      this.emitChanged(splitZ((await this.run(['diff', '--name-only', '-z', before, after])).stdout));
    }
  }

  // A name for the remote version that is not taken yet (two conflicts in the same second).
  async freeCopyName(rel, taken) {
    const first = conflictName(rel);
    let copy = first;
    for (let n = 2; taken.has(copy) || (await this.vault.fileInfo(copy)); n++) {
      const ext = path.posix.extname(first);
      copy = `${first.slice(0, first.length - ext.length)} ${n}${ext}`;
    }
    taken.add(copy);
    return copy;
  }

  // Every conflicted file keeps our version; the remote version is saved as a "(conflito …)" copy.
  // A file deleted on one side and changed on the other is kept with the change.
  async resolveConflicts() {
    const unmerged = await this.unmergedEntries();
    if (!unmerged.size) {
      await this.run(['merge', '--abort'], { okCodes: [0, 128] });
      throw new Error('Git: não foi possível juntar as mudanças do remoto');
    }
    const conflicts = [];
    const taken = new Set();
    try {
      for (const [rel, stages] of unmerged) {
        if (stages[2] && stages[3]) {
          const copy = await this.freeCopyName(rel, taken);
          const { stdout } = await this.run(['cat-file', 'blob', stages[3]]);
          await this.vault.write(copy, stdout);
          await this.run(['checkout', '-q', '--ours', '--', rel]);
          await this.run(['add', '--', rel, copy]);
          conflicts.push({ path: rel, copy });
        } else if (stages[2]) {
          await this.run(['checkout', '-q', '--ours', '--', rel]);
          await this.run(['add', '--', rel]);
        } else if (stages[3]) {
          await this.run(['checkout', '-q', '--theirs', '--', rel]);
          await this.run(['add', '--', rel]);
        } else {
          await this.run(['rm', '-q', '--cached', '--', rel]);
        }
      }
      if ((await this.unmergedEntries()).size) throw new Error('Git: conflito que o app não sabe resolver');
      await this.run(['commit', '-q', '--no-verify', '--no-edit']);
    } catch (err) {
      await this.run(['merge', '--abort'], { okCodes: [0, 128] });
      throw err;
    }
    for (const conflict of conflicts) this.emit('conflict', conflict);
  }

  // path -> {1: base sha, 2: ours sha, 3: theirs sha}
  async unmergedEntries() {
    const out = new Map();
    for (const entry of splitZ((await this.run(['ls-files', '-u', '-z'])).stdout)) {
      const match = entry.match(/^\d+ ([0-9a-f]+) ([123])\t(.*)$/s);
      if (!match) continue;
      const [, sha, stage, rel] = match;
      if (!out.has(rel)) out.set(rel, {});
      out.get(rel)[stage] = sha;
    }
    return out;
  }

  async needsPush() {
    const head = await this.revParse('HEAD');
    if (!head) return false;
    const theirs = await this.revParse(this.remoteRef);
    if (!theirs) return true;
    const { stdout } = await this.run(['rev-list', '--count', `${this.remoteRef}..HEAD`]);
    return Number(stdout.toString().trim()) > 0;
  }

  // ---------- version history ----------

  // Commits that touched the note, newest first, following renames: [{sha, at, author, subject, path}].
  // Read-only, so it does not wait for a sync round.
  async history(rel, { limit = 200 } = {}) {
    this.vault.resolve(rel);
    if (!(await this.hasRepo()) || !(await this.revParse('HEAD'))) return [];
    const { stdout } = await this.run([
      'log', '--follow', `--max-count=${limit}`, '--format=%x1e%H%x1f%at%x1f%an%x1f%s', '--name-only', '-z', '--', rel,
    ]);
    const out = [];
    for (const record of stdout.toString('utf8').split('\x1e')) {
      const [header, rest = ''] = record.split('\0\n');
      if (!rest) continue;
      const [sha, at, author, ...subject] = header.split('\x1f');
      out.push({ sha, at: Number(at) * 1000, author, subject: subject.join('\x1f'), path: rest.split('\0')[0] });
    }
    return out;
  }

  // The file as it was in one commit (null when it did not exist there).
  async showFile(sha, rel) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new Error('Versão inválida');
    this.vault.resolve(rel);
    const res = await this.run(['cat-file', 'blob', `${sha}:${rel}`], { okCodes: [0, 128] });
    return res.code === 0 ? res.stdout : null;
  }

  emitChanged(paths) {
    if (paths.length) this.emit('local-changed', paths);
  }
}

module.exports = { GitSync, GitError, validateRemoteUrl, validateBranch, describeGitError, findGit };
