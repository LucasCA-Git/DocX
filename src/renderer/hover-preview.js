import { el } from './dom';
import { noteEmbed } from './embeds';
import { linkAt } from '../shared/links';

const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 300;
const NOTE_RE = /\.(md|markdown|txt)$/i;

// Page preview: hovering an internal link shows the note in a popover. In the
// reading view (and inside previews/embeds) plain hover is enough; in the editor Ctrl must be held,
// so moving the mouse while writing does not pop things up.
export function setupHoverPreview({ store, workspace }) {
  let popover = null;
  let showTimer = null;
  let hideTimer = null;
  let current = null;

  const hide = () => {
    clearTimeout(showTimer);
    popover?.remove();
    popover = null;
    current = null;
  };

  // href and source note of the link under the mouse, or null.
  function linkInfo(target, ctrl) {
    const source = target.closest('[data-source-path]')?.dataset.sourcePath ?? workspace.activePath;
    const reading = target.closest('.markdown-reading a.internal-link');
    if (reading) return { anchor: reading, href: reading.dataset.href, source };
    if (!ctrl) return null;
    const widget = target.closest('.cm-lp-wikilink');
    if (widget?.title) return { anchor: widget, href: widget.title, source };
    const raw = target.closest('.cm-wikilink');
    if (raw) {
      const link = linkAt(raw.textContent, 2);
      if (link) return { anchor: raw, href: link.target + (link.subpath ? `#${link.subpath}` : ''), source };
    }
    return null;
  }

  function show(info) {
    const hash = info.href.indexOf('#');
    const name = hash === -1 ? info.href : info.href.slice(0, hash);
    const subpath = hash === -1 ? null : info.href.slice(hash + 1);
    const path = store.resolve(name, info.source);
    if (!path || !NOTE_RE.test(path)) return;
    hide();
    current = info.anchor;
    popover = el('div', { class: 'popover hover-popover' }, noteEmbed(path, subpath, { store, workspace, depth: 0, seen: new Set() }));
    popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    popover.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    });
    document.body.append(popover);
    const r = info.anchor.getBoundingClientRect();
    const w = popover.offsetWidth;
    const h = popover.offsetHeight;
    const below = r.bottom + 8 + h < window.innerHeight;
    popover.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    popover.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  }

  document.addEventListener('mouseover', (event) => {
    if (popover?.contains(event.target)) return;
    const info = linkInfo(event.target, event.ctrlKey || event.metaKey);
    if (!info) {
      clearTimeout(showTimer);
      if (popover) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, HIDE_DELAY_MS);
      }
      return;
    }
    if (info.anchor === current) {
      clearTimeout(hideTimer);
      return;
    }
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(info), SHOW_DELAY_MS);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('mousedown', (event) => {
    if (popover && !popover.contains(event.target)) hide();
  });
  window.addEventListener('blur', hide);
}
