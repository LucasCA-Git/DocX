import { el, icon, displayName } from './dom';
import { renderMarkdown } from './markdown';
import { sectionText } from '../shared/metadata';
import { enhanceRendered } from './render-extras';
import { loadExcalidraw } from './views/excalidraw-view';
import { isLightTheme } from './appearance';

const MAX_DEPTH = 3;

// The rendered content of a note (or of one heading/block of it) for ![[note]] embeds and the
// hover preview. Links inside resolve against the embedded note and open from there.
// ctx: { store, workspace, depth, seen (paths on the way, to stop embed cycles) }
export function renderNoteContent(path, subpath, ctx) {
  const text = ctx.workspace.currentText(path) ?? ctx.store.texts.get(path) ?? '';
  const section = sectionText(text, subpath);
  const body = el('div', { class: 'markdown-embed-content markdown-reading', dataset: { sourcePath: path } });
  if (section === null) {
    body.append(el('p', { class: 'embed-missing', text: `"${subpath}" não foi encontrado em "${displayName(path)}".` }));
    return body;
  }
  body.innerHTML = renderMarkdown(section, (target) => ctx.store.resolve(target, path));
  enhanceRendered(body);
  body.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || !body.contains(link) || link.closest('.markdown-embed-content') !== body) return;
    event.preventDefault();
    event.stopPropagation();
    if (link.dataset.tag !== undefined) ctx.workspace.searchFor(`tag:#${link.dataset.tag}`);
    else if (link.dataset.href !== undefined) ctx.workspace.openLink(link.dataset.href, path, { newTab: event.ctrlKey || event.metaKey });
    else if (/^https?:\/\//.test(link.href)) window.open(link.href);
  });
  fillEmbeds(body, { ...ctx, depth: (ctx.depth ?? 0) + 1, seen: new Set([...(ctx.seen ?? []), path]) });
  return body;
}

// An embed box: title bar (click opens the note) and the content.
export function noteEmbed(path, subpath, ctx) {
  const box = el('div', { class: 'markdown-embed' },
    el('div', {
      class: 'markdown-embed-title',
      onclick: (event) => ctx.workspace.openLink(subpath ? `${path}#${subpath}` : path, null, { newTab: event.ctrlKey || event.metaKey }),
    }, icon('file-text', 14), el('span', { text: displayName(path) + (subpath ? ` › ${subpath.replace(/^\^/, '')}` : '') }), icon('arrow-up-right', 14)));
  if ((ctx.depth ?? 0) >= MAX_DEPTH || ctx.seen?.has(path)) {
    box.append(el('p', { class: 'embed-missing', text: 'Incorporação recursiva não mostrada.' }));
  } else {
    box.append(renderNoteContent(path, subpath, ctx));
  }
  return box;
}

// ![[desenho.excalidraw]]: the drawing as a picture (an <img> of its SVG export, so nothing in it
// runs inside the note); the title bar opens it in the editor.
function drawingEmbed(path, ctx) {
  const body = el('div', { class: 'drawing-embed-body', text: 'Carregando desenho…' });
  const box = el('div', { class: 'markdown-embed drawing-embed' },
    el('div', {
      class: 'markdown-embed-title',
      onclick: (event) => ctx.workspace.openFile(path, { newTab: event.ctrlKey || event.metaKey }),
    }, icon('pen-tool', 14), el('span', { text: displayName(path).replace(/\.excalidraw$/i, '') }), icon('arrow-up-right', 14)),
    body);
  Promise.all([window.docs.read(path), loadExcalidraw()])
    .then(([text, lib]) => lib.renderSvg(text, { dark: !isLightTheme() }))
    .then((svg) => body.replaceChildren(el('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: displayName(path) })))
    .catch(() => body.replaceChildren(el('p', { class: 'embed-missing', text: 'Não foi possível mostrar o desenho.' })));
  return box;
}

// Replaces the placeholders renderMarkdown leaves for note embeds.
export function fillEmbeds(root, ctx) {
  for (const holder of root.querySelectorAll('.markdown-embed-placeholder')) {
    if (holder.closest('.markdown-embed-content') !== root.closest('.markdown-embed-content')) continue;
    const { embedPath, embedSub, embedKind } = holder.dataset;
    holder.replaceWith(embedKind === 'drawing' ? drawingEmbed(embedPath, ctx) : noteEmbed(embedPath, embedSub || null, ctx));
  }
}
