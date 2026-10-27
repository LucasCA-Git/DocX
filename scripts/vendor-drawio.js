'use strict';

// Diagram editor: the official draw.io webapp (https://github.com/jgraph/drawio, Apache-2.0),
// downloaded once at a fixed version, checked against a fixed SHA-256 and pruned of what the app
// never uses (server code, cloud connectors, dev sources, other languages, math).
const AdmZip = require('adm-zip');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = '32.4.1';
const URL = `https://github.com/jgraph/drawio/releases/download/v${VERSION}/draw.war`;
const SHA256 = 'b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820';

const root = path.join(__dirname, '..');
const cacheFile = path.join(root, '.cache', `drawio-${VERSION}.war`);

const KEEP_LANGS = new Set(['dia.txt', 'dia_pt-br.txt', 'dia_pt.txt']);
const DROP_DIRS = [
  'WEB-INF/', 'META-INF/', 'connect/', 'math4/', 'js/diagramly/', 'js/grapheditor/',
  'js/dropbox/', 'js/onedrive/', 'js/simplepeer/',
];
const DROP_FILES = new Set([
  'service-worker.js', 'js/integrate.min.js', 'js/viewer-static.min.js', 'js/embed.dev.js',
]);

function wanted(name) {
  if (name.endsWith('/')) return false;
  if (DROP_DIRS.some((dir) => name.startsWith(dir))) return false;
  if (DROP_FILES.has(name) || name.endsWith('.map') || /^workbox-.*\.js$/.test(name)) return false;
  if (!name.includes('/') && name.endsWith('.html') && name !== 'index.html') return false;
  if (name.startsWith('resources/dia') && !KEEP_LANGS.has(name.slice('resources/'.length))) return false;
  return true;
}

async function download() {
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`draw.io: download falhou (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function vendorDrawio(outDir) {
  const marker = path.join(outDir, '.version');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === SHA256) return;
  let war = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile) : null;
  if (!war || crypto.createHash('sha256').update(war).digest('hex') !== SHA256) {
    console.log(`Baixando draw.io ${VERSION}…`);
    war = await download();
    const sum = crypto.createHash('sha256').update(war).digest('hex');
    if (sum !== SHA256) throw new Error(`draw.io: SHA-256 inesperado (${sum})`);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, war);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  const zip = new AdmZip(war);
  let count = 0;
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!wanted(name)) continue;
    const target = path.join(outDir, ...name.split('/'));
    const relative = path.relative(outDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`draw.io: caminho inválido no pacote (${name})`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    count++;
  }
  fs.writeFileSync(marker, SHA256);
  console.log(`draw.io ${VERSION}: ${count} arquivos em ${path.relative(root, outDir)}`);
}

module.exports = { vendorDrawio, DRAWIO_VERSION: VERSION };
