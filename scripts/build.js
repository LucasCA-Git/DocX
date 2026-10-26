'use strict';

// Bundles the renderer (CodeMirror, marked, DOMPurify, KaTeX, d3-force worker) into dist/renderer with its HTML/CSS.
const esbuild = require('esbuild');
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

for (const file of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(src, file), path.join(out, file));
}

// Libraries used as files: KaTeX's stylesheet and fonts, Mermaid (loaded on the first diagram).
const vendor = path.join(out, 'vendor');
fs.mkdirSync(path.join(vendor, 'katex'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'katex', 'dist', 'katex.min.css'), path.join(vendor, 'katex', 'katex.min.css'));
fs.cpSync(path.join(root, 'node_modules', 'katex', 'dist', 'fonts'), path.join(vendor, 'katex', 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), path.join(vendor, 'mermaid.min.js'));
