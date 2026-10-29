'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

// The assistant runs the user's own Claude Code (their login and subscription): natively when it is
// installed on this system, or inside WSL on Windows. Claude only gets the read-only tools, limited
// to the vault folder (Read rules also cover Glob and Grep) and with no hooks, plugins, MCP servers or
// CLAUDE.md of the user's setup (--safe-mode). Writes come back as <docx-action> blocks in the text
// (see shared/claude-actions.js) that the user approves one by one in the app.

const MODELS = ['', 'opus', 'sonnet', 'haiku'];
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROMPT = 100_000;
const RUN_TIMEOUT_MS = 15 * 60_000;
const LOCATE_TIMEOUT_MS = 20_000;
const STDERR_TAIL = 4000;
// Beyond this the answer is cut: a runaway output would fill memory and the IPC channel.
const MAX_OUTPUT = 2 * 1024 * 1024;

// Inside WSL: claude on the PATH, in the usual install folders, or on the login shell's PATH (fish,
// zsh… add ~/.npm-global/bin there, not in sh's).
const WSL_LOCATE_SCRIPT = [
  'command -v claude 2>/dev/null && exit 0',
  'for f in "$HOME/.local/bin/claude" "$HOME/.npm-global/bin/claude" "$HOME/.claude/local/claude" /usr/local/bin/claude; do',
  '  [ -x "$f" ] && { echo "$f"; exit 0; }',
  'done',
  's=$(getent passwd "$(id -un)" | cut -d: -f7)',
  '[ -n "$s" ] && "$s" -lc "command -v claude" 2>/dev/null',
].join('\n');

const SYSTEM_PROMPT = `Você é o assistente do DocX, um app de notas em Markdown (parecido com o Obsidian). O usuário conversa com você num painel ao lado das notas.

# O vault
- A pasta atual é o vault do usuário. Use Glob, Grep e Read (caminhos relativos a ela) para encontrar e ler notas. Você não consegue ler nada fora do vault.
- Notas são arquivos .md. Links entre notas: [[Nome da nota]] (sem .md), [[Nome|texto]], [[Nome#Título]]. Imagens: ![[arquivo.png]]. Tags: #tag. Front matter YAML opcional (tags, aliases). Callouts: > [!note] Título. Fórmulas: $...$ e $$...$$.
- Pastas aparecem como "galáxias" no grafo; links [[ ]] ligam as notas entre si.
- Canvas (.canvas) usam JSON Canvas 1.0: {"nodes":[{"id":"a1","type":"text","x":0,"y":0,"width":260,"height":120,"text":"markdown"}, {"id":"a2","type":"file","file":"Pasta/Nota.md",...}, {"id":"g1","type":"group","label":"Grupo",...}],"edges":[{"id":"e1","fromNode":"a1","toNode":"a2","fromSide":"right","toSide":"left","label":"opcional"}]}. Espalhe os nós sem sobreposição.
- Diagramas: prefira um bloco \`\`\`mermaid dentro de uma nota. Para um diagrama editável no editor do draw.io, crie um .drawio com o XML sem compressão: <mxfile><diagram name="Página-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>…</root></mxGraphModel></diagram></mxfile>.

# Como alterar o vault
Você não escreve arquivos diretamente. Para criar ou mudar algo, inclua na resposta um bloco por arquivo; o DocX mostra cada um ao usuário, que aprova antes de aplicar:

<docx-action type="create" path="Pasta/Nova nota.md">
conteúdo completo do arquivo
</docx-action>

<docx-action type="edit" path="Pasta/Nota existente.md">
conteúdo completo e final do arquivo (não só o trecho alterado)
</docx-action>

<docx-action type="mkdir" path="Pasta/Subpasta"></docx-action>

Regras:
- Tipos permitidos: create (arquivo novo, que ainda não existe), edit (substitui todo o conteúdo de um arquivo existente) e mkdir (pasta). Não há como apagar nem renomear.
- Extensões permitidas: .md, .txt, .canvas, .excalidraw, .drawio. Caminhos sempre relativos ao vault, com "/", sem começar com ".".
- Antes de editar, leia o arquivo com Read e mantenha tudo o que não deve mudar.
- Antes de criar, procure notas parecidas com Glob/Grep. Ligue a nota nova às existentes que forem relevantes com [[links]].
- create já cria as pastas do caminho; mkdir só para pastas vazias.
- Nunca coloque os blocos <docx-action> dentro de \`\`\` e nunca diga que já criou ou alterou algo: você está propondo, o usuário aplica.

# Estilo
- Responda no idioma do usuário (normalmente português do Brasil), de forma direta e curta. Explique em uma ou duas frases o que está propondo.
- A mensagem do usuário pode terminar com "[DocX] Nota aberta agora: caminho". É a nota na tela; "esta nota" se refere a ela.`;

// C:\Users\x -> /mnt/c/Users/x (WSL's default mount of Windows drives).
function winToWsl(p) {
  const m = /^([a-z]):[\\/]?(.*)$/i.exec(p);
  if (!m) return null;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`.replace(/\/+$/, '');
}

function buildArgs({ sessionId, resume, model, promptFile }) {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--safe-mode',
    '--strict-mcp-config',
    '--permission-prompts', 'none',
    '--tools', 'Read,Glob,Grep',
    '--allowedTools', 'Read(./**)',
    // The Git folder may hold credentials (a token in the remote URL).
    '--disallowedTools', 'Read(./.git/**)',
    '--system-prompt-file', promptFile,
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
    ...(model ? ['--model', model] : []),
  ];
}

const toolDetail = (input = {}) => input.file_path ?? input.pattern ?? input.path ?? '';

// One line of Claude Code's stream-json output -> the events the panel needs.
function streamEvents(msg) {
  if (msg?.type === 'system' && msg.subtype === 'init') return [{ type: 'start', sessionId: msg.session_id }];
  if (msg?.type === 'stream_event') {
    const e = msg.event;
    if (e?.type === 'content_block_start' && e.content_block?.type === 'text') return [{ type: 'delta', text: '', newBlock: true }];
    if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') return [{ type: 'delta', text: e.delta.text }];
    return [];
  }
  if (msg?.type === 'assistant' && Array.isArray(msg.message?.content)) {
    return msg.message.content.flatMap((c) => {
      if (c.type === 'text') return [{ type: 'text', text: c.text }];
      if (c.type === 'tool_use') return [{ type: 'tool', name: c.name, detail: String(toolDetail(c.input)) }];
      return [];
    });
  }
  if (msg?.type === 'result') {
    return [{ type: 'result', isError: Boolean(msg.is_error), result: typeof msg.result === 'string' ? msg.result : '', costUsd: msg.total_cost_usd ?? null }];
  }
  return [];
}

function validateRequest(req) {
  if (typeof req?.prompt !== 'string' || !req.prompt.trim() || req.prompt.length > MAX_PROMPT) throw new Error('Mensagem inválida');
  if (typeof req.sessionId !== 'string' || !SESSION_RE.test(req.sessionId)) throw new Error('Conversa inválida');
  if (!MODELS.includes(req.model ?? '')) throw new Error('Modelo inválido');
  return { prompt: req.prompt, sessionId: req.sessionId, resume: Boolean(req.resume), model: req.model ?? '' };
}

const exists = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

class ClaudeBridge {
  constructor({ userDataDir, platform = process.platform, env = process.env }) {
    this.userDataDir = userDataDir;
    this.platform = platform;
    this.env = env;
    this.runs = new Map();
    // Runs between ask() and spawn, and the ones cancelled in that window.
    this.starting = new Set();
    this.cancelled = new Set();
    this.located = null;
  }

  reset() {
    this.located = null;
  }

  // -> { via: 'native', command } | { via: 'wsl', command: wsl.exe, claude: path inside WSL } | null
  async locate(override = '') {
    if (this.located?.override === override) return this.located.result;
    let result = null;
    if (override === 'wsl') result = await this.locateWsl();
    else if (override) result = exists(override) ? { via: 'native', command: override } : null;
    else result = this.locateNative() ?? (this.platform === 'win32' ? await this.locateWsl() : null);
    // A miss is not cached: the user may install Claude Code and retry.
    if (result) this.located = { override, result };
    return result;
  }

  locateNative() {
    const home = os.homedir();
    const win = this.platform === 'win32';
    const names = win ? ['claude.exe'] : ['claude'];
    const dirs = [
      ...(this.env.PATH ?? this.env.Path ?? '').split(path.delimiter).filter((dir) => path.isAbsolute(dir)),
      path.join(home, '.local', 'bin'),
      ...(win
        ? [path.join(this.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin')]
        : [path.join(home, '.npm-global', 'bin'), path.join(home, '.claude', 'local'), '/usr/local/bin']),
    ];
    for (const dir of dirs) {
      for (const name of names) {
        const file = path.join(dir, name);
        if (exists(file)) return { via: 'native', command: file };
      }
    }
    return null;
  }

  async locateWsl() {
    if (this.platform !== 'win32') return null;
    const wsl = path.join(this.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
    if (!exists(wsl)) return null;
    const out = await run(wsl, ['-e', 'sh', '-c', WSL_LOCATE_SCRIPT], LOCATE_TIMEOUT_MS);
    const claude = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('/'));
    return claude ? { via: 'wsl', command: wsl, claude } : null;
  }

  // Starts one answer. onEvent gets { type: 'start'|'delta'|'text'|'tool'|'done', … }; 'done' always
  // comes last, with { error } when it failed.
  async ask(runId, request, { vaultRoot, override }, onEvent) {
    const req = validateRequest(request);
    // One answer at a time: the panel waits for 'done' before sending again.
    if (this.runs.size || this.starting.size) throw new Error('O Claude ainda está respondendo');
    this.starting.add(runId);
    try {
      return await this.start(runId, req, { vaultRoot, override }, onEvent);
    } finally {
      this.starting.delete(runId);
      this.cancelled.delete(runId);
    }
  }

  async start(runId, req, { vaultRoot, override }, onEvent) {
    const found = await this.locate(override);
    if (this.cancelled.has(runId)) {
      onEvent({ type: 'done', text: '', cancelled: true });
      return { via: found?.via ?? null };
    }
    if (!found) {
      throw new Error('Claude Code não encontrado. Instale o Claude Code e entre com sua conta (rode "claude" num terminal). No Windows ele pode estar no próprio Windows ou dentro do WSL.');
    }
    const dir = path.join(this.userDataDir, 'claude');
    fs.mkdirSync(dir, { recursive: true });
    const promptFile = path.join(dir, 'system-prompt.md');
    fs.writeFileSync(promptFile, SYSTEM_PROMPT);

    let command;
    let args;
    let options = { windowsHide: true };
    if (found.via === 'wsl') {
      const wslPrompt = winToWsl(promptFile);
      if (!wslPrompt || !winToWsl(vaultRoot)) throw new Error('Pelo WSL o vault precisa estar num disco local (C:, D:…)');
      command = found.command;
      args = ['--cd', vaultRoot, '-e', found.claude, ...buildArgs({ ...req, promptFile: wslPrompt })];
    } else {
      command = found.command;
      args = buildArgs({ ...req, promptFile });
      options = { ...options, cwd: vaultRoot, env: this.env };
    }

    const child = spawn(command, args, options);
    this.runs.set(runId, child);
    const texts = [];
    let size = 0;
    let result = null;
    let stderr = '';
    let finished = false;
    const finish = (extra) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      this.runs.delete(runId);
      onEvent({ type: 'done', text: texts.join('\n\n'), ...extra });
    };
    const timer = setTimeout(() => {
      this.kill(child);
      finish({ error: 'O Claude demorou demais e foi interrompido.' });
    }, RUN_TIMEOUT_MS);

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      size += line.length;
      if (size > MAX_OUTPUT) {
        if (!finished) this.kill(child);
        finish({ error: 'A resposta ficou grande demais e foi cortada.' });
        return;
      }
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      for (const event of streamEvents(msg)) {
        if (event.type === 'text') texts.push(event.text);
        if (event.type === 'result') result = event;
        else onEvent(event);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on('error', (err) => finish({ error: `Não foi possível iniciar o Claude Code: ${err.message}` }));
    child.on('close', (code, signal) => {
      if (child.cancelled) finish({ cancelled: true });
      else if (result && !result.isError) finish({ costUsd: result.costUsd });
      else if (result) finish({ error: result.result || 'O Claude Code respondeu com um erro.' });
      else finish({ error: stderr.trim() || `O Claude Code fechou sem responder (${signal ?? `código ${code}`}).` });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(req.prompt);
    return { via: found.via };
  }

  cancel(runId) {
    if (this.starting.has(runId)) this.cancelled.add(runId);
    const child = this.runs.get(runId);
    if (!child) return;
    child.cancelled = true;
    this.kill(child);
  }

  // On Windows kill() only ends the direct child (claude.exe or wsl.exe): taskkill takes the tree.
  kill(child) {
    if (this.platform === 'win32' && child.pid) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      child.kill();
    }
  }

  cancelAll() {
    for (const runId of this.runs.keys()) this.cancel(runId);
  }
}

module.exports = { ClaudeBridge, buildArgs, streamEvents, validateRequest, winToWsl, SYSTEM_PROMPT };
