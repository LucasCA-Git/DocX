import katex from 'katex';
import DOMPurify from 'dompurify';
import { el, icon } from './dom';
import { highlightToNodes } from './languages';
import { calloutType } from '../shared/callouts';

// Callout icon and default title per canonical type (see shared/callouts.js for the aliases).
const CALLOUTS = {
  note: ['pencil', 'Nota'],
  abstract: ['clipboard', 'Resumo'],
  info: ['info', 'Info'],
  todo: ['circle-check', 'A fazer'],
  tip: ['flame', 'Dica'],
  success: ['check', 'Sucesso'],
  question: ['help', 'Pergunta'],
  warning: ['warning', 'Atenção'],
  failure: ['x', 'Falha'],
  danger: ['zap', 'Perigo'],
  bug: ['bug', 'Bug'],
  example: ['list', 'Exemplo'],
  quote: ['quote', 'Citação'],
};
export function calloutInfo(name) {
  const type = calloutType(name);
  const [iconName, title] = CALLOUTS[type];
  return { type, iconName, title: name.toLowerCase() === type ? title : name[0].toUpperCase() + name.slice(1) };
}

export function renderMath(target, tex, displayMode) {
  try {
    katex.render(tex, target, { displayMode, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml' });
  } catch (err) {
    target.textContent = tex;
    target.classList.add('math-error');
    target.title = String(err.message ?? err);
  }
}

// Mermaid is big: its script loads on the first diagram.
let mermaidReady = null;
function loadMermaid() {
  mermaidReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/mermaid.min.js';
    script.onload = () => {
      const light = document.body.classList.contains('theme-light');
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // Plain SVG text labels (HTML labels need foreignObject, which the sanitizer removes).
        htmlLabels: false,
        theme: light ? 'default' : 'dark',
        flowchart: { htmlLabels: false },
      });
      resolve(window.mermaid);
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o Mermaid'));
    document.head.append(script);
  });
  return mermaidReady;
}

let diagramCount = 0;
export async function renderMermaid(target, code) {
  target.classList.add('mermaid-diagram');
  target.textContent = 'Desenhando diagrama…';
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(`docs-mermaid-${++diagramCount}`, code);
    // As an image: the diagram's own CSS (which a note can influence through themeCSS/classDef)
    // cannot reach the rest of the app, and nothing in it can run.
    const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style'] });
    const img = el('img', { class: 'mermaid-image', alt: 'Diagrama', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}` });
    // The SVG says width="100%": keep the diagram's natural width instead (from its viewBox).
    const box = clean.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/);
    if (box) img.style.width = `${Math.round(Number(box[1]))}px`;
    target.replaceChildren(img);
  } catch (err) {
    target.replaceChildren(el('pre', { class: 'mermaid-error', text: `Erro no diagrama: ${err.message ?? err}` }));
  }
}

// Adds what the sanitized HTML from renderMarkdown cannot carry: KaTeX math, Mermaid diagrams,
// colored code, callouts, footnote jumps and clickable checklists (onTask(index) toggles the n-th
// task of the note; without it the boxes stay read-only).
export function enhanceRendered(root, { onTask = null } = {}) {
  for (const node of root.querySelectorAll('.math[data-tex]')) renderMath(node, node.dataset.tex, node.classList.contains('math-block'));

  for (const code of root.querySelectorAll('pre > code')) {
    const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9);
    if (!lang) continue;
    if (lang === 'mermaid') {
      const holder = el('div');
      code.parentElement.replaceWith(holder);
      renderMermaid(holder, code.textContent);
      continue;
    }
    const nodes = highlightToNodes(code.textContent.replace(/\n$/, ''), lang);
    if (nodes) code.replaceChildren(...nodes);
    code.parentElement.dataset.lang = lang;
  }

  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild;
    if (first?.tagName !== 'P') continue;
    // Works on DOM nodes (never re-parses HTML strings, which could bring back what the sanitizer
    // removed): the marker is cut from the first text node, the title is everything up to the
    // first line break.
    const head = first.firstChild;
    const m = head?.nodeType === Node.TEXT_NODE ? head.textContent.match(/^\[!([\w-]+)\]([+-]?)[ \t]*/) : null;
    if (!m) continue;
    head.textContent = head.textContent.slice(m[0].length);
    const titleNodes = [];
    for (let node = first.firstChild; node;) {
      const next = node.nextSibling;
      if (node.nodeName === 'BR') {
        node.remove();
        break;
      }
      if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('\n')) {
        const cut = node.textContent.indexOf('\n');
        titleNodes.push(document.createTextNode(node.textContent.slice(0, cut)));
        node.textContent = node.textContent.slice(cut + 1);
        break;
      }
      titleNodes.push(node);
      node = next;
    }
    const info = calloutInfo(m[1]);
    const inner = el('span', { class: 'callout-title-inner' });
    if (titleNodes.some((n) => n.textContent.trim())) inner.append(...titleNodes);
    else {
      titleNodes.forEach((n) => n.remove?.());
      inner.textContent = info.title;
    }
    const title = el('div', { class: 'callout-title' }, el('span', { class: 'callout-icon' }, icon(info.iconName, 16)), inner);
    if (!first.textContent.trim() && !first.querySelector('img, input')) first.remove();
    const content = el('div', { class: 'callout-content' }, ...quote.childNodes);
    const callout = el(m[2] ? 'details' : 'div', { class: 'callout', dataset: { callout: info.type } });
    if (m[2]) {
      const summary = el('summary', {}, title);
      callout.append(summary, content);
      if (m[2] === '+') callout.open = true;
    } else {
      callout.append(title, content);
    }
    quote.replaceWith(callout);
  }

  // Only this note's own boxes (embeds are filled in later, but be safe), in document order.
  const own = [...root.querySelectorAll('input[type=checkbox]')].filter((box) => box.closest('.markdown-embed-content, .markdown-reading') === root || !box.closest('.markdown-embed-content'));
  own.forEach((box, index) => {
    box.closest('li')?.classList.add('task-list-item');
    if (!onTask) return;
    box.disabled = false;
    box.addEventListener('click', (event) => {
      event.preventDefault();
      onTask(index);
    });
  });

  // Footnote links jump inside this rendering (embeds and previews have their own copies). The
  // root may be rendered again (reading view): the listener is added once.
  if (root.dataset.footnoteJumps) return;
  root.dataset.footnoteJumps = '1';
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || link.dataset.href !== undefined || link.dataset.tag !== undefined || link.getAttribute('href') === '#') return;
    event.preventDefault();
    event.stopPropagation();
    root.querySelector(`[id="${CSS.escape(link.getAttribute('href').slice(1))}"]`)?.scrollIntoView({ block: 'center' });
  });
}
