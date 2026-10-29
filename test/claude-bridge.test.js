'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeBridge, buildArgs, streamEvents, validateRequest, winToWsl } = require('../src/main/claude');

const SESSION = '3a0bfb29-ddf6-4101-b6bb-8d9cee60cd58';

test('winToWsl maps Windows drive paths to /mnt', () => {
  assert.equal(winToWsl('C:\\Users\\lucas\\Notas'), '/mnt/c/Users/lucas/Notas');
  assert.equal(winToWsl('D:/x/'), '/mnt/d/x');
  assert.equal(winToWsl('\\\\server\\share'), null);
  assert.equal(winToWsl('/home/x'), null);
});

test('buildArgs keeps Claude read-only and inside the vault', () => {
  const first = buildArgs({ sessionId: SESSION, resume: false, model: '', promptFile: '/p.md' });
  assert.deepEqual(first.slice(first.indexOf('--tools'), first.indexOf('--tools') + 4), ['--tools', 'Read,Glob,Grep', '--allowedTools', 'Read(./**)']);
  for (const flag of ['--safe-mode', '--strict-mcp-config', '-p']) assert.ok(first.includes(flag), flag);
  assert.deepEqual(first.slice(-2), ['--session-id', SESSION]);
  const next = buildArgs({ sessionId: SESSION, resume: true, model: 'sonnet', promptFile: '/p.md' });
  assert.deepEqual(next.slice(-4), ['--resume', SESSION, '--model', 'sonnet']);
  assert.ok(!next.some((a) => /skip-permissions|Write|Edit|Bash/.test(a)));
});

test('validateRequest rejects bad sessions, models and empty prompts', () => {
  assert.deepEqual(validateRequest({ prompt: 'oi', sessionId: SESSION }), { prompt: 'oi', sessionId: SESSION, resume: false, model: '' });
  assert.throws(() => validateRequest({ prompt: ' ', sessionId: SESSION }), /Mensagem/);
  assert.throws(() => validateRequest({ prompt: 'oi', sessionId: '--dangerously-skip-permissions' }), /Conversa/);
  assert.throws(() => validateRequest({ prompt: 'oi', sessionId: SESSION, model: 'x --y' }), /Modelo/);
});

test('streamEvents turns stream-json lines into panel events', () => {
  assert.deepEqual(streamEvents({ type: 'system', subtype: 'init', session_id: SESSION }), [{ type: 'start', sessionId: SESSION }]);
  assert.deepEqual(streamEvents({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ol' } } }), [{ type: 'delta', text: 'Ol' }]);
  assert.deepEqual(streamEvents({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } }), [{ type: 'delta', text: '', newBlock: true }]);
  assert.deepEqual(streamEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'A.md' } }, { type: 'text', text: 'oi' }] } }),
    [{ type: 'tool', name: 'Read', detail: 'A.md' }, { type: 'text', text: 'oi' }]);
  assert.deepEqual(streamEvents({ type: 'result', is_error: false, result: 'oi', total_cost_usd: 0.01 }), [{ type: 'result', isError: false, result: 'oi', costUsd: 0.01 }]);
  assert.deepEqual(streamEvents({ type: 'user' }), []);
});

// A stand-in for Claude Code: prints stream-json and echoes its stdin, args and cwd.
function fakeClaude(dir, body) {
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return file;
}

const collect = (bridge, request, opts) => new Promise((resolve, reject) => {
  const events = [];
  bridge.ask('run-1', request, opts, (event) => {
    events.push(event);
    if (event.type === 'done') resolve(events);
  }).catch(reject);
});

test('ClaudeBridge runs Claude Code in the vault and streams its answer', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-claude-'));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-vault-'));
  const claude = fakeClaude(dir, `
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: '${SESSION}' });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'parte' } } });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({ input, cwd: process.cwd(), args: process.argv.slice(2) }) }] } });
  out({ type: 'result', is_error: false, result: 'ok', total_cost_usd: 0.02 });
});`);
  const bridge = new ClaudeBridge({ userDataDir: path.join(dir, 'data'), platform: 'linux', env: { PATH: dir } });
  const events = await collect(bridge, { prompt: 'crie uma nota', sessionId: SESSION }, { vaultRoot: vault, override: '' });
  assert.deepEqual(events.map((e) => e.type), ['start', 'delta', 'text', 'done']);
  const done = events.at(-1);
  assert.equal(done.costUsd, 0.02);
  const seen = JSON.parse(done.text);
  assert.equal(seen.input, 'crie uma nota');
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(vault));
  assert.ok(seen.args.includes('--system-prompt-file'));
  assert.match(fs.readFileSync(seen.args[seen.args.indexOf('--system-prompt-file') + 1], 'utf8'), /docx-action/);
  assert.equal((await bridge.locate('')).command, claude);
});

test('ClaudeBridge reports errors from Claude Code and a missing install', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-claude-'));
  fakeClaude(dir, `
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }) + '\\n');
});`);
  const bridge = new ClaudeBridge({ userDataDir: path.join(dir, 'data'), platform: 'linux', env: { PATH: dir } });
  const events = await collect(bridge, { prompt: 'oi', sessionId: SESSION }, { vaultRoot: dir, override: '' });
  assert.match(events.at(-1).error, /login/);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-empty-'));
  const missing = new ClaudeBridge({ userDataDir: empty, platform: 'linux', env: { PATH: empty } });
  missing.locateNative = () => null;
  await assert.rejects(missing.ask('run-2', { prompt: 'oi', sessionId: SESSION }, { vaultRoot: empty, override: '' }, () => {}), /não encontrado/);
});

test('ClaudeBridge.cancel stops a running answer', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-claude-'));
  fakeClaude(dir, 'setInterval(() => {}, 1000);');
  const bridge = new ClaudeBridge({ userDataDir: path.join(dir, 'data'), platform: 'linux', env: { PATH: dir } });
  const done = collect(bridge, { prompt: 'oi', sessionId: SESSION }, { vaultRoot: dir, override: '' });
  await new Promise((r) => setTimeout(r, 200));
  bridge.cancel('run-1');
  assert.equal((await done).at(-1).cancelled, true);
});

test('ClaudeBridge runs one answer at a time and honours a cancel before Claude Code starts', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-claude-'));
  fakeClaude(dir, 'setInterval(() => {}, 1000);');
  const bridge = new ClaudeBridge({ userDataDir: path.join(dir, 'data'), platform: 'linux', env: { PATH: dir } });
  let release;
  const realLocate = bridge.locate.bind(bridge);
  bridge.locate = async (o) => { await new Promise((r) => { release = r; }); return realLocate(o); };
  const events = [];
  const first = bridge.ask('run-a', { prompt: 'oi', sessionId: SESSION }, { vaultRoot: dir, override: '' }, (e) => events.push(e));
  await assert.rejects(bridge.ask('run-b', { prompt: 'oi', sessionId: SESSION }, { vaultRoot: dir, override: '' }, () => {}), /respondendo/);
  bridge.cancel('run-a');
  release();
  await first;
  assert.deepEqual(events, [{ type: 'done', text: '', cancelled: true }]);
  assert.equal(bridge.runs.size, 0);
});
