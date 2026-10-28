'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { Vault } = require('../src/main/vault');
const {
  GitSync, validateRemoteUrl, validateBranch, describeGitError, findGit, conflictName,
} = require('../src/main/sync/git-sync');

// Isolated from the developer's ~/.gitconfig: no identity, no hooks, no credential helpers. An empty
// file rather than os.devNull, which Git for Windows cannot open (\\.\nul).
const EMPTY_CONFIG = path.join(os.tmpdir(), 'docs-empty-gitconfig');
require('node:fs').writeFileSync(EMPTY_CONFIG, '');
const ENV = { GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_CONFIG_NOSYSTEM: '1' };

async function tmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function bareRemote() {
  const dir = await tmp('docs-remote-');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', dir], { env: { ...process.env, ...ENV } });
  return dir;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...ENV } }).toString();
}

// One "machine": its own vault folder syncing with the shared bare remote.
async function machine(remote, { root } = {}) {
  root ??= await tmp('docs-git-vault-');
  const vault = new Vault(root);
  const sync = new GitSync({ vault, url: remote, branch: 'main', allowFile: true, env: ENV, hostname: 'teste' });
  const events = { changed: [], conflicts: [] };
  sync.on('local-changed', (paths) => events.changed.push(...paths));
  sync.on('conflict', (c) => events.conflicts.push(c));
  const write = (rel, text) => vault.write(rel, text);
  const read = async (rel) => (await vault.read(rel)).toString('utf8');
  const exists = async (rel) => (await vault.fileInfo(rel)) !== null;
  return { root, vault, sync, events, write, read, exists };
}

const remoteFiles = (remote) => git(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n').filter(Boolean).sort();
const remoteText = (remote, rel) => git(remote, 'show', `main:${rel}`);

test('commits and pushes the vault to an empty remote', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('ideias.md', '# Ideias');
  await a.write('projetos/git.md', 'sync com git');
  await a.sync.syncAll();
  assert.deepEqual(remoteFiles(remote), ['ideias.md', 'projetos/git.md']);
  assert.equal(remoteText(remote, 'ideias.md'), '# Ideias');
});

test('an empty folder receives every note from the remote', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('ideias.md', '# Ideias');
  await a.write('img/foto.png', Buffer.from([0, 1, 2, 255]));
  await a.sync.syncAll();

  const b = await machine(remote);
  await b.sync.syncAll();
  assert.equal(await b.read('ideias.md'), '# Ideias');
  assert.deepEqual([...await b.vault.read('img/foto.png')], [0, 1, 2, 255]);
  assert.deepEqual(b.events.changed.sort(), ['ideias.md', 'img/foto.png']);
});

test('never commits dotfiles, trash or temp files', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('nota.md', 'x');
  await a.write('.trash/velha.md', 'apagada');
  await a.write('.docs-sync/state.json', '{}');
  await a.write('.nota.md.123.docs-tmp', 'tmp');
  await a.write('node_modules/x.js', 'x');
  await a.sync.syncAll();
  assert.deepEqual(remoteFiles(remote), ['nota.md']);
});

test('edits and deletions on one machine reach the other', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  const b = await machine(remote);
  await a.write('nota.md', 'v1');
  await a.write('apagar.md', 'tchau');
  await a.sync.syncAll();
  await b.sync.syncAll();

  await a.write('nota.md', 'v2 editada');
  await a.vault.trash('apagar.md');
  await a.sync.syncAll();
  await b.sync.syncAll();
  assert.equal(await b.read('nota.md'), 'v2 editada');
  assert.equal(await b.exists('apagar.md'), false);
});

test('different notes edited on both machines are merged', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  const b = await machine(remote);
  await a.write('a.md', 'a1');
  await a.write('b.md', 'b1');
  await a.sync.syncAll();
  await b.sync.syncAll();

  await a.write('a.md', 'a2');
  await b.write('b.md', 'b2');
  await a.sync.syncAll();
  await b.sync.syncAll(); // b's push needs a merge with a's commit
  await a.sync.syncAll();
  for (const m of [a, b]) {
    assert.equal(await m.read('a.md'), 'a2');
    assert.equal(await m.read('b.md'), 'b2');
  }
  assert.equal(remoteText(remote, 'b.md'), 'b2');
});

test('the same note edited on both machines keeps both versions', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  const b = await machine(remote);
  await a.write('nota.md', 'base\n');
  await a.sync.syncAll();
  await b.sync.syncAll();

  await a.write('nota.md', 'versão do A\n');
  await a.sync.syncAll();
  await b.write('nota.md', 'versão do B\n');
  await b.sync.syncAll();

  assert.equal(await b.read('nota.md'), 'versão do B\n');
  assert.equal(b.events.conflicts.length, 1);
  const { path: original, copy } = b.events.conflicts[0];
  assert.equal(original, 'nota.md');
  assert.match(copy, /^nota \(conflito \d{4}-\d{2}-\d{2} \d{6}\)\.md$/);
  assert.equal(await b.read(copy), 'versão do A\n');
  // No conflict markers anywhere, and both versions are on the remote.
  assert.equal(remoteText(remote, 'nota.md'), 'versão do B\n');
  assert.equal(remoteText(remote, copy), 'versão do A\n');

  await a.sync.syncAll();
  assert.equal(await a.read(copy), 'versão do A\n');
  assert.equal(await a.read('nota.md'), 'versão do B\n');
});

test('a note deleted on one machine and edited on the other is kept', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  const b = await machine(remote);
  await a.write('nota.md', 'base');
  await a.sync.syncAll();
  await b.sync.syncAll();

  await a.vault.trash('nota.md');
  await a.sync.syncAll();
  await b.write('nota.md', 'editada no B');
  await b.sync.syncAll();
  assert.equal(await b.read('nota.md'), 'editada no B');
  assert.equal(remoteText(remote, 'nota.md'), 'editada no B');

  // And the other way round: edited remotely, deleted here.
  await a.sync.syncAll();
  assert.equal(await a.read('nota.md'), 'editada no B');
});

test('a folder with its own notes joins a remote that already has notes', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('remota.md', 'do remoto');
  await a.write('igual.md', 'versão remota');
  await a.sync.syncAll();

  const c = await machine(remote);
  await c.write('local.md', 'só aqui');
  await c.write('igual.md', 'versão local');
  await c.sync.syncAll();
  assert.equal(await c.read('remota.md'), 'do remoto');
  assert.equal(await c.read('local.md'), 'só aqui');
  assert.equal(await c.read('igual.md'), 'versão local');
  assert.equal(c.events.conflicts.length, 1);
  assert.equal(await c.read(c.events.conflicts[0].copy), 'versão remota');
  assert.deepEqual(remoteFiles(remote), [c.events.conflicts[0].copy, 'igual.md', 'local.md', 'remota.md'].sort());
});

test('works offline: commits locally and pushes once the remote is back', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('nota.md', 'v1');
  await a.sync.syncAll();

  const away = `${remote}-fora`;
  await fs.rename(remote, away);
  await a.write('nota.md', 'v2 offline');
  await assert.rejects(a.sync.syncAll());
  assert.match(git(a.root, 'log', '-1', '--format=%s'), /^vault: /);
  assert.equal(git(a.root, 'status', '--porcelain'), '');

  await fs.rename(away, remote);
  await a.sync.syncAll();
  assert.equal(remoteText(remote, 'nota.md'), 'v2 offline');
});

test('uses a local identity when git has none configured', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('nota.md', 'x');
  await a.sync.syncAll();
  assert.match(git(remote, 'log', '-1', '--format=%an <%ae>'), /^DocX <docx@teste>\n$/);
});

test('keeps line endings byte for byte', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('crlf.md', 'linha 1\r\nlinha 2\r\n');
  await a.sync.syncAll();
  const b = await machine(remote);
  await b.sync.syncAll();
  assert.equal(await b.read('crlf.md'), 'linha 1\r\nlinha 2\r\n');
});

test('handles names with spaces, accents and brackets', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('Ação e reação [rascunho].md', 'ok');
  await a.sync.syncAll();
  const b = await machine(remote);
  await b.sync.syncAll();
  assert.equal(await b.read('Ação e reação [rascunho].md'), 'ok');
  assert.deepEqual(b.events.changed, ['Ação e reação [rascunho].md']);
});

test('a later sync with nothing new does not commit', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  await a.write('nota.md', 'x');
  await a.sync.syncAll();
  const before = git(a.root, 'rev-parse', 'HEAD');
  await a.sync.syncAll();
  assert.equal(git(a.root, 'rev-parse', 'HEAD'), before);
});

test('reports status and points origin at a changed URL', async () => {
  const remote = await bareRemote();
  const other = await bareRemote();
  const a = await machine(remote);
  const states = [];
  a.sync.on('status', (s) => states.push(s.state));
  await a.write('nota.md', 'x');
  await a.sync.syncAll();
  assert.deepEqual(states, ['syncing', 'idle']);

  const moved = new GitSync({ vault: a.vault, url: other, branch: 'main', allowFile: true, env: ENV });
  await moved.syncAll();
  assert.deepEqual(remoteFiles(other), ['nota.md']);
});

test('validateRemoteUrl accepts https and ssh, rejects the rest', () => {
  for (const ok of [
    'https://github.com/lucas/notas.git',
    'https://gitlab.com/grupo/sub/notas',
    'git@github.com:lucas/notas.git',
    'ssh://git@github.com/lucas/notas.git',
    'ssh://git@host.com:2222/notas.git',
  ]) assert.equal(validateRemoteUrl(ok), ok);
  for (const bad of [
    'https://lucas:ghp_token@github.com/lucas/notas.git',
    'https://ghp_token@github.com/lucas/notas.git',
    'http://github.com/lucas/notas.git',
    'file:///tmp/repo',
    'ext::sh -c touch% /tmp/pwned',
    '-uhelp',
    '--upload-pack=touch /tmp/x',
    'git@github.com:-oProxyCommand=x',
    'https://github.com/a b',
    '-oProxyCommand=x@host:path',
    'ssh://-oProxyCommand=x@host/path',
    'https://github.com/../x',
    'https://github.com/a//b',
    '',
    '/tmp/repo',
  ]) assert.throws(() => validateRemoteUrl(bad), /URL/, bad);
});

test('describeGitError turns git stderr into a readable message', () => {
  assert.match(describeGitError('fatal: Authentication failed for https://github.com/x'), /autentica/i);
  assert.match(describeGitError('fatal: unable to access \'https://github.com/x/\': Could not resolve host: github.com'), /conex/i);
  assert.match(describeGitError("fatal: repository 'https://github.com/x/' not found"), /não encontrado/i);
  assert.match(describeGitError('git@github.com: Permission denied (publickey).'), /SSH/);
  assert.match(describeGitError('fatal: algo estranho'), /algo estranho/);
});

test('lists the versions of a note, following renames, and reads an old one', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  // Long enough for git's rename detection to see the moved file as the same note.
  const body = 'Uma nota com bastante texto para o git reconhecer a renomeação.\n'.repeat(5);
  await a.write('rascunho.md', `${body}v1`);
  await a.sync.syncAll();
  await a.write('rascunho.md', `${body}v2`);
  await a.sync.syncAll();
  await a.vault.rename('rascunho.md', 'pasta/Final [ok].md');
  await a.write('pasta/Final [ok].md', `${body}v3`);
  await a.sync.syncAll();

  const versions = await a.sync.history('pasta/Final [ok].md');
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((v) => v.path), ['pasta/Final [ok].md', 'rascunho.md', 'rascunho.md']);
  assert.match(versions[0].subject, /^vault: /);
  assert.equal(versions[0].author, 'DocX');
  assert.ok(versions[0].at > Date.now() - 60_000);
  assert.equal((await a.sync.showFile(versions[2].sha, versions[2].path)).toString(), `${body}v1`);
  assert.equal((await a.sync.showFile(versions[1].sha, versions[1].path)).toString(), `${body}v2`);
  assert.equal(await a.sync.showFile(versions[2].sha, 'nao-existe.md'), null);
  await assert.rejects(a.sync.showFile('HEAD', 'rascunho.md'), /Versão inválida/);
  await assert.rejects(a.sync.showFile(versions[0].sha, '../fora.md'), /fora do vault/);
  assert.deepEqual(await (await machine(remote)).sync.history('x.md'), []);
});

test('validateBranch keeps refspecs and options out', () => {
  for (const ok of ['main', 'notas/pessoal', 'v1.0']) assert.equal(validateBranch(ok), ok);
  for (const bad of ['-f', '--template=/x', 'main:refs/heads/x', '+main', 'a..b', 'a.lock', 'a//b', '.x', 'a/.b', 'a/', 'HEAD', 'a b', '']) {
    assert.throws(() => validateBranch(bad), /branch/, bad);
  }
  assert.throws(() => new GitSync({ vault: new Vault(os.tmpdir()), url: 'git@github.com:a/b.git', branch: '--template=/x' }), /branch/);
});

test('refuses a pre-existing repository whose config could run programs', async () => {
  const remote = await bareRemote();
  const root = await tmp('docs-git-vault-');
  git(root, 'init', '-q');
  const marker = path.join(root, '..', `pwned-${path.basename(root)}`);
  git(root, 'config', 'core.fsmonitor', `touch ${marker}`);
  const a = await machine(remote, { root });
  await a.write('nota.md', 'x');
  await assert.rejects(a.sync.syncAll(), /core\.fsmonitor/);
  await assert.rejects(fs.access(marker));
});

test('accepts a pre-existing plain repository and never runs its hooks or filters', async () => {
  const remote = await bareRemote();
  const root = await tmp('docs-git-vault-');
  git(root, 'init', '-q', '-b', 'main');
  const marker = path.join(root, '..', `hook-${path.basename(root)}`);
  for (const hook of ['post-commit', 'post-merge', 'post-checkout', 'pre-commit']) {
    await fs.writeFile(path.join(root, '.git', 'hooks', hook), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  }
  const a = await machine(remote, { root });
  await a.write('nota.md', 'x');
  await a.sync.syncAll();
  assert.deepEqual(remoteFiles(remote), ['nota.md']);
  await assert.rejects(fs.access(marker));
});

test('symlinks from the remote arrive as plain files', { skip: process.platform === 'win32' }, async () => {
  const remote = await bareRemote();
  const work = await tmp('docs-git-work-');
  git(work, 'init', '-q', '-b', 'main');
  await fs.symlink('/etc', path.join(work, 'fora'));
  git(work, 'add', '-A');
  git(work, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'link');
  git(work, 'push', '-q', remote, 'main');

  const a = await machine(remote);
  await a.sync.syncAll();
  const st = await fs.lstat(path.join(a.root, 'fora'));
  assert.equal(st.isSymbolicLink(), false);
  assert.equal(await a.read('fora'), '/etc');
});

test('a remote carrying the app sync folder is refused', async () => {
  const remote = await bareRemote();
  const work = await tmp('docs-git-work-');
  git(work, 'init', '-q', '-b', 'main');
  await fs.mkdir(path.join(work, '.docs-sync'));
  await fs.writeFile(path.join(work, '.docs-sync', 'state.json'), '{}');
  git(work, 'add', '-A');
  git(work, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'x');
  git(work, 'push', '-q', remote, 'main');
  const a = await machine(remote);
  await assert.rejects(a.sync.syncAll(), /\.docs-sync/);
});

test('error text never shows a token', () => {
  const msg = describeGitError("fatal: something odd at 'https://ghp_abc123@github.com/x' token ghp_zzz999");
  assert.doesNotMatch(msg, /abc123|zzz999/);
  assert.doesNotMatch(describeGitError('fatal: port 4030 busy'), /autentica/);
});

test('findGit returns an absolute git.exe on Windows, never one in a relative folder', () => {
  assert.equal(findGit({ platform: 'linux' }), 'git');
  const found = findGit({ platform: 'win32', envPath: '.;notas;' });
  assert.ok(found === null || /^[A-Z]:\\/.test(found));
});

test('after a login failure the timer pauses, a manual sync still runs', async () => {
  const remote = await bareRemote();
  const a = await machine(remote);
  a.sync.round = async () => { throw new Error('Falha de autenticação no Git: x'); };
  await assert.rejects(a.sync.syncAll(), /autentica/);
  let ran = false;
  a.sync.round = async () => { ran = true; };
  await assert.rejects(a.sync.syncAll({ force: false }), /autentica/);
  assert.equal(ran, false);
  await a.sync.syncAll();
  assert.equal(ran, true);
  await a.sync.syncAll({ force: false });
});

test('conflictName keeps the extension', () => {
  const name = conflictName('pasta/nota.md', new Date(2026, 9, 21, 15, 30, 5));
  assert.equal(name, 'pasta/nota (conflito 2026-10-21 153005).md');
});
