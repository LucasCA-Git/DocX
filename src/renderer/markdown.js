import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';
import DOMPurify from 'dompurify';
import { parseLinks, maskFences } from '../shared/links';
import { parseTags } from '../shared/metadata';
import { stripComments } from '../shared/markdown-extras';
import { assetUrl } from '../shared/asset-url';
import { displayName, IMAGE_FILE } from './dom';

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// DOMPurify's default URI allow-list plus our attachment scheme.
const ALLOWED_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|vault-asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// ![[img.png|300]] or |300x200 sets the size, like Obsidian.
const SIZE_RE = /^(\d+)(?:x(\d+))?$/;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|ogv)$/i;

// Obsidian additions on top of GFM: ==highlight==, $math$ / $$math$$ (rendered later by
// render-extras.js from data-tex), footnotes.
const md = new Marked({ gfm: true });
md.use(markedFootnote({ description: 'Notas de rodapé', footnoteDivider: true }));
md.use({
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (src) => src.indexOf('=='),
      tokenizer(src) {
        const m = src.match(/^==(?!=)([^\n]*?[^=\s\n])==(?!=)/) ?? src.match(/^==([^=\s])==/);
        if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        return undefined;
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
      },
    },
    {
      name: 'mathBlock',
      level: 'block',
      start: (src) => src.indexOf('$$'),
      tokenizer(src) {
        const m = src.match(/^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/);
        if (m) return { type: 'mathBlock', raw: m[0], tex: m[1].trim() };
        return undefined;
      },
      renderer: (token) => `<div class="math math-block" data-tex="${escapeHtml(token.tex)}"></div>`,
    },
    {
      name: 'mathInline',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const m = src.match(/^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?![\d$])/);
        if (m) return { type: 'mathInline', raw: m[0], tex: m[1] };
        return undefined;
      },
      renderer: (token) => `<span class="math math-inline" data-tex="${escapeHtml(token.tex)}"></span>`,
    },
  ],
});

export function linkLabel(link) {
  if (link.alias) return link.alias;
  const name = link.target ? displayName(link.target) : '';
  return link.subpath ? `${name}${name ? ' > ' : ''}${link.subpath}` : name;
}

function renderLink(link, resolved) {
  const href = link.target + (link.subpath ? `#${link.subpath}` : '');
  return `<a href="#" class="internal-link${resolved ? '' : ' is-unresolved'}" data-href="${escapeHtml(href)}">${escapeHtml(linkLabel(link))}</a>`;
}

function renderEmbed(link, resolved) {
  if (!resolved) {
    return `<span class="internal-embed is-unresolved">"${escapeHtml(link.target)}" não foi encontrado.</span>`;
  }
  if (/\.(md|markdown|txt)$/i.test(resolved)) {
    // Filled in by embeds.js (it needs the store and the workspace).
    return `<div class="markdown-embed-placeholder" data-embed-path="${escapeHtml(resolved)}" data-embed-sub="${escapeHtml(link.subpath ?? '')}"></div>`;
  }
  if (AUDIO_RE.test(resolved)) return `<audio controls src="${escapeHtml(assetUrl(resolved))}"></audio>`;
  if (VIDEO_RE.test(resolved)) return `<video controls src="${escapeHtml(assetUrl(resolved))}"></video>`;
  if (!IMAGE_FILE.test(resolved)) return renderLink(link, resolved);
  const size = link.alias?.match(SIZE_RE);
  const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : '';
  const alt = size ? displayName(resolved) : linkLabel(link);
  return `<span class="internal-embed image-embed" data-href="${escapeHtml(link.target)}"><img src="${escapeHtml(assetUrl(resolved))}" alt="${escapeHtml(alt)}"${dims}></span>`;
}

// Reading view HTML. Wikilinks become <a class="internal-link" data-href>, image embeds <img>
// served by the main process (resolved through `resolve(target)`), #tags <a class="tag">;
// %%comments%% and ^block ids are dropped. The result is sanitized; render-extras.js then adds
// math, diagrams, code colors, callouts and clickable checkboxes.
export function renderMarkdown(raw, resolve) {
  const uncommented = stripComments(raw);
  const masked = maskFences(uncommented).split('\n');
  const text = uncommented.split('\n').map((line, i) => (masked[i] === line ? line.replace(/\s\^[A-Za-z0-9-]+(\r?)$/, '$1') : line)).join('\n');
  let source = '';
  let last = 0;
  const pieces = [
    ...parseLinks(text).map((link) => ({ ...link, kind: 'link' })),
    ...parseTags(text).map((tag) => ({ ...tag, kind: 'tag' })),
  ].sort((a, b) => a.from - b.from);
  for (const piece of pieces) {
    if (piece.from < last) continue;
    source += text.slice(last, piece.from);
    last = piece.to;
    if (piece.kind === 'tag') {
      source += `<a href="#" class="tag" data-tag="${escapeHtml(piece.tag)}">#${escapeHtml(piece.tag)}</a>`;
      continue;
    }
    const resolved = resolve(piece.target);
    source += piece.embed ? renderEmbed(piece, resolved) : renderLink(piece, resolved);
  }
  source += text.slice(last);
  // Notes come from the remote too: no <style>/style= that could restyle or cover the app UI.
  return DOMPurify.sanitize(md.parse(source), {
    ADD_ATTR: ['data-href', 'data-tag', 'data-embed-path', 'data-embed-sub', 'data-tex', 'controls'],
    ADD_TAGS: ['audio', 'video'],
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP,
  });
}
