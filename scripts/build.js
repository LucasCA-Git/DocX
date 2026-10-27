'use strict';

// Bundles the renderer (CodeMirror, marked, DOMPurify, KaTeX, d3-force worker) into dist/renderer with its HTML/CSS.
const esbuild = require('esbuild');
const { vendorDrawio } = require('./vendor-drawio');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'renderer');
const out = path.join(root, 'dist', 'renderer');

fs.mkdirSync(out, { recursive: true });

// The app and the Graph View's simulation worker (loaded with new Worker('graph-worker.js')).
for (const [entry, file] of [['app.js', 'renderer.js'], ['graph-worker.js', 'graph-worker.js']]) {
  esbuild.buildSync({
    entryPoints: [path.join(src, entry)],
    bundle: true,
    outfile: path.join(out, file),
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    sourcemap: true,
    logLevel: 'info',
  });
}

for (const file of ['index.html', 'styles.css', 'print.css']) {
  fs.copyFileSync(path.join(src, file), path.join(out, file));
}

// Libraries used as files: KaTeX's stylesheet and fonts, Mermaid (loaded on the first diagram).
const vendor = path.join(out, 'vendor');
fs.mkdirSync(path.join(vendor, 'katex'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'katex', 'dist', 'katex.min.css'), path.join(vendor, 'katex', 'katex.min.css'));
fs.cpSync(path.join(root, 'node_modules', 'katex', 'dist', 'fonts'), path.join(vendor, 'katex', 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), path.join(vendor, 'mermaid.min.js'));

// Drawing editor (Excalidraw + React), bundled apart from the app and loaded on demand. Its fonts
// are served from here (EXCALIDRAW_ASSET_PATH) instead of a CDN.
const excalidrawOut = path.join(vendor, 'excalidraw');
const excalidrawPkg = path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod');
esbuild.buildSync({
  entryPoints: [path.join(src, 'excalidraw', 'entry.js')],
  bundle: true,
  outfile: path.join(excalidrawOut, 'excalidraw.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  loader: { '.woff2': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
  legalComments: 'linked',
  logLevel: 'warning',
});
if (!fs.existsSync(path.join(excalidrawOut, 'fonts'))) {
  fs.cpSync(path.join(excalidrawPkg, 'fonts'), path.join(excalidrawOut, 'fonts'), { recursive: true });
}

// Diagram editor (draw.io webapp), served by the main process under docx-drawio://app/.
vendorDrawio(path.join(vendor, 'drawio')).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
