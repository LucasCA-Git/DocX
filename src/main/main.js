'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { ConfigStore, isS3Configured, isGitConfigured } = require('./config');
const { Vault } = require('./vault');
const { SyncEngine } = require('./sync/engine');
const { SyncState } = require('./sync/state');
const { S3Remote } = require('./sync/s3-remote');
const { GitSync } = require('./sync/git-sync');
const { resolveAsset, assetHeaders, parseRange } = require('./asset-protocol');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { ASSET_SCHEME } = require('../shared/asset-url');
const { migrateUserData } = require('./migrate');

const os = require('node:os');

const SYNC_INTERVAL_MS = 30_000;
const MAX_EXPORT_HTML = 20 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 600;
const MAX_READ_TEXTS = 20_000;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

let win = null;
let configStore = null;
let config = null;
let vault = null;
let engine = null;
let stopWatch = null;
let syncTimer = null;
let lastStatus = { state: 'disabled' };
const pendingPaths = new Set();
let watchTimer = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setStatus(status) {
  lastStatus = { provider: config?.syncProvider ?? 'none', ...status };
  status = lastStatus;
  send('sync:status', status);
}

function closeVault() {
  stopWatch?.();
  clearInterval(syncTimer);
  clearTimeout(watchTimer);
  pendingPaths.clear();
  engine?.removeAllListeners();
  stopWatch = null;
  syncTimer = null;
  engine = null;
  vault = null;
}

async function openVault() {
  closeVault();
  if (!config.vaultPath) {
    setStatus({ state: 'disabled', message: 'Escolha uma pasta para as notas' });
    return;
  }
  vault = new Vault(config.vaultPath);
  await fs.mkdir(vault.root, { recursive: true });
  stopWatch = vault.watch(onLocalChange);

  if (isGitConfigured(config)) {
    // Git never runs hooks from the vault: core.hooksPath points at this empty, app-owned folder.
    const hooksDir = path.join(app.getPath('userData'), 'git-no-hooks');
    await fs.rm(hooksDir, { recursive: true, force: true });
    await fs.mkdir(hooksDir, { recursive: true });
    engine = new GitSync({ vault, url: config.gitUrl, branch: config.gitBranch, hooksDir });
  } else if (isS3Configured(config)) {
    const remote = new S3Remote(config);
    const statePath = path.join(vault.root, '.docs-sync', 'state.json');
    const state = await SyncState.load(statePath, `${config.bucket}/${config.prefix}`);
    engine = new SyncEngine({ vault, remote, state });
  } else {
    setStatus({ state: 'disabled', message: 'Sincronização não configurada' });
    return;
  }
  engine.on('status', setStatus);
  engine.on('local-changed', (paths) => send('vault:changed', paths));
  engine.on('conflict', (conflict) => send('sync:conflict', conflict));

  const syncAll = () => engine?.syncAll({ force: false }).catch(() => {});
  syncAll();
  syncTimer = setInterval(syncAll, SYNC_INTERVAL_MS);
}

function requireGit() {
  if (!(engine instanceof GitSync)) throw new Error('O histórico de versões precisa da sincronização com Git');
  return engine;
}

// fs.watch fires several events per save; batch them and sync each touched path.
function onLocalChange(rel) {
  pendingPaths.add(rel);
  clearTimeout(watchTimer);
  watchTimer = setTimeout(flushLocalChanges, WATCH_DEBOUNCE_MS);
}

async function flushLocalChanges() {
  const paths = [...pendingPaths];
  pendingPaths.clear();
  send('vault:changed', paths);
  if (!engine || !vault) return;

  let needFullSync = false;
  for (const rel of paths) {
    // A folder event (rename/delete of a whole folder) only names the folder, not its files.
    if (await vault.isDirectory(rel)) needFullSync = true;
    else if (!(await vault.fileInfo(rel)) && !engine.hasBase(rel)) needFullSync = true;
    else engine.syncFile(rel).catch(() => {});
  }
  if (needFullSync) engine.syncAll().catch(() => {});
}

function requireVault() {
  if (!vault) throw new Error('Nenhuma pasta de notas configurada');
  return vault;
}

function requireString(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} inválido`);
  return value;
}

// Only our own window may call the API.
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender !== win.webContents) throw new Error('Origem não autorizada');
    return fn(...args);
  });
}

function registerIpc() {
  const publicConfig = () => ({ ...config, s3Configured: isS3Configured(config), gitConfigured: isGitConfigured(config) });
  handle('config:get', publicConfig);
  handle('config:save', async (input) => {
    config = configStore.save(input);
    await openVault();
    return publicConfig();
  });
  handle('vault:choose', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Pasta das notas',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('vault:list', () => (vault ? vault.listTree({ withTimes: true }) : { files: [], folders: [], times: {} }));
  handle('vault:mkdir', async (rel) => {
    await requireVault().mkdir(requireString(rel, 'Caminho'));
  });
  handle('vault:read', async (rel) => (await requireVault().read(requireString(rel, 'Caminho'))).toString('utf8'));
  handle('vault:read-texts', async (rels) => {
    if (!Array.isArray(rels) || rels.length > MAX_READ_TEXTS || !rels.every((r) => typeof r === 'string')) throw new Error('Caminhos inválidos');
    return requireVault().readTexts(rels);
  });
  handle('vault:write', async (rel, text) => {
    await requireVault().write(requireString(rel, 'Caminho'), requireString(text, 'Conteúdo'));
  });
  handle('vault:create-binary', async (rel, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Arquivo inválido ou maior que 100 MB');
    await requireVault().create(requireString(rel, 'Caminho'), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
  handle('vault:copy', async (from, to) => {
    await requireVault().copy(requireString(from, 'Origem'), requireString(to, 'Destino'));
  });
  handle('vault:reveal', (rel) => {
    shell.showItemInFolder(rel ? requireVault().resolve(requireString(rel, 'Caminho')) : requireVault().root);
  });
  handle('vault:create', async (rel) => {
    await requireVault().create(requireString(rel, 'Caminho'));
  });
  handle('vault:rename', async (from, to) => {
    await requireVault().rename(requireString(from, 'Origem'), requireString(to, 'Destino'));
  });
  handle('vault:delete', async (rel) => {
    await requireVault().trash(requireString(rel, 'Caminho'));
  });
  handle('sync:status', () => lastStatus);
  handle('sync:now', async () => {
    if (!engine) throw new Error('Sincronização desligada: configure o Git nas configurações');
    try {
      await engine.syncAll();
    } catch (err) {
      // Only the readable message crosses to the renderer (and to Electron's IPC error log).
      throw new Error(err.message);
    }
  });
  handle('history:list', (rel) => requireGit().history(requireString(rel, 'Caminho')));
  handle('history:read', async (sha, rel) => {
    const body = await requireGit().showFile(requireString(sha, 'Versão'), requireString(rel, 'Caminho'));
    return body === null ? null : body.toString('utf8');
  });
  handle('note:export-pdf', (html, title) => exportPdf(requireString(html, 'Conteúdo'), requireString(title, 'Título')));
  handle('app:titlebar', (colors) => {
    const hex = /^#[0-9a-f]{6}$/i;
    if (!hex.test(colors?.color) || !hex.test(colors?.symbolColor)) throw new Error('Cores inválidas');
    win?.setTitleBarOverlay?.({ color: colors.color, symbolColor: colors.symbolColor, height: 40 });
    win?.setBackgroundColor(colors.color);
  });
  handle('app:close-ready', () => {
    closeWindowNow();
  });
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "Exportar para PDF": the note's rendered (already sanitized) HTML is printed by a hidden window
// with JavaScript off and a CSP that only allows local styles, images and fonts.
async function exportPdf(html, title) {
  if (html.length > MAX_EXPORT_HTML) throw new Error('Nota grande demais para exportar');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar para PDF',
    defaultPath: `${title.replace(/[\\/:*?"<>|]/g, '-') || 'nota'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  // Styles and KaTeX fonts are inlined: the page may load nothing from the disk (no file:), only
  // vault images and data: URLs.
  const css = await printStyles();
  const body = html.replace(/<\/?(meta|link|base|iframe|object|embed|script|form)\b[^>]*>/gi, '');
  const page = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vault-asset: data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'">
<style>${css}</style>
<title>${escapeHtml(title)}</title></head><body><article class="markdown-reading"><h1 class="print-title">${escapeHtml(title)}</h1>${body}</article></body></html>`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-print-'));
  const tmp = path.join(dir, 'nota.html');
  await fs.writeFile(tmp, page, { flag: 'wx' });
  const printer = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  const block = (event) => event.preventDefault();
  printer.webContents.on('will-navigate', block);
  printer.webContents.on('will-redirect', block);
  printer.webContents.on('will-frame-navigate', block);
  printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await printer.loadFile(tmp);
    // Images (vault-asset://) finish loading after the page itself.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const pdf = await printer.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
    await fs.writeFile(filePath, pdf);
    shell.showItemInFolder(filePath);
    return filePath;
  } finally {
    printer.destroy();
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

let printCss = null;
async function printStyles() {
  if (printCss) return printCss;
  const dir = path.join(__dirname, '..', '..', 'dist', 'renderer');
  const katexDir = path.join(dir, 'vendor', 'katex');
  let katex = await fs.readFile(path.join(katexDir, 'katex.min.css'), 'utf8');
  // Only the woff2 fonts, as data: URLs.
  const fonts = new Map();
  for (const [, file] of katex.matchAll(/url\(fonts\/([\w-]+\.woff2)\)/g)) {
    if (!fonts.has(file)) fonts.set(file, (await fs.readFile(path.join(katexDir, 'fonts', file))).toString('base64'));
  }
  katex = katex.replace(/src:([^;}]*)/g, (decl) => {
    const m = decl.match(/url\(fonts\/([\w-]+\.woff2)\)/);
    return m ? `src:url(data:font/woff2;base64,${fonts.get(m[1])}) format("woff2")` : decl;
  });
  printCss = `${katex}\n${await fs.readFile(path.join(dir, 'print.css'), 'utf8')}`;
  return printCss;
}

// Right-click in text fields: spelling suggestions, then cut/copy/paste.
function showEditMenu(params) {
  if (!params.isEditable && !params.selectionText) return;
  const items = [];
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
      items.push({ label: suggestion, click: () => win?.webContents.replaceMisspelling(suggestion) });
    }
    if (!params.dictionarySuggestions.length) items.push({ label: 'Sem sugestões', enabled: false });
    items.push({ label: 'Adicionar ao dicionário', click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: 'separator' });
  }
  items.push(
    { label: 'Recortar', role: 'cut', enabled: params.isEditable && params.editFlags.canCut },
    { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
    { label: 'Colar', role: 'paste', enabled: params.isEditable && params.editFlags.canPaste },
    { type: 'separator' },
    { label: 'Selecionar tudo', role: 'selectAll' },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

// Closing waits for the renderer to flush unsaved notes (vault:write resolves only after the file
// is on disk), with a timeout so a stuck renderer cannot block quitting.
const CLOSE_TIMEOUT_MS = 3000;
let closeReady = false;

function closeWindowNow() {
  closeReady = true;
  setImmediate(() => win?.close());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    title: 'DocX',
    // Windows takes the icon from the .exe; Linux needs it on the window (dock and Alt+Tab).
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, '..', '..', 'build', 'icon.png') } : {}),
    backgroundColor: '#1e1e1e',
    // Tabs live in the title bar; the OS keeps drawing min/max/close.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#262626', symbolColor: '#dadada', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  win.removeMenu();
  win.webContents.on('context-menu', (_event, params) => showEditMenu(params));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  win.on('close', (event) => {
    if (closeReady) return;
    event.preventDefault();
    send('app:before-close');
    setTimeout(closeWindowNow, CLOSE_TIMEOUT_MS);
  });
  win.on('closed', () => {
    win = null;
  });
}

// Images embedded in notes (![[x.png]]) load from vault-asset://local/<path>; only images inside
// the open vault are served, everything else is a 404.
protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } }]);

function registerAssetProtocol() {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const full = await resolveAsset(vault, request.url);
    if (!full) return new Response('Not found', { status: 404 });
    // Streamed, with byte ranges so audio/video can seek without loading the whole file.
    const { size } = await fs.stat(full);
    const headers = { ...assetHeaders(full), 'Accept-Ranges': 'bytes' };
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = size ? Readable.toWeb(createReadStream(full, { start, end })) : null;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: { ...headers, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) },
    });
  });
}

try {
  migrateUserData(path.join(app.getPath('appData'), 'docs'), app.getPath('userData'));
} catch (err) {
  console.error('Falha ao migrar as configurações antigas:', err);
}

app.whenReady().then(async () => {
  registerAssetProtocol();
  try {
    session.defaultSession.setSpellCheckerLanguages(['pt-BR', 'en-US']);
  } catch {
    // The OS spell checker (Windows/macOS) picks languages itself.
  }
  configStore = new ConfigStore(app.getPath('userData'));
  config = configStore.load();
  registerIpc();
  createWindow();
  try {
    await openVault();
  } catch (err) {
    setStatus({ state: 'error', message: err.message });
  }
});

app.on('window-all-closed', () => {
  closeVault();
  app.quit();
});
