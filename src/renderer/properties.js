import { el } from './dom';
import { parseLinks } from '../shared/links';

const URL_RE = /^https?:\/\/\S+$/;

// Front matter as Obsidian's "Propriedades" table: lists as chips, tags clickable, [[links]] and
// URLs as links. Read-only here; the YAML itself is edited as text.
// handlers: { onTag(tag), onLink(href, event), resolve(target) }
export function renderProperties(data, { onTag, onLink, resolve }) {
  const value = (key, v) => {
    if (v === null || v === undefined || v === '') return el('span', { class: 'metadata-empty', text: 'Vazio' });
    if (typeof v === 'boolean') return el('input', { type: 'checkbox', class: 'metadata-checkbox', checked: v, disabled: true, 'aria-label': key });
    if (Array.isArray(v)) {
      return el('span', { class: 'metadata-chips' }, v.map((item) => chip(key, item)));
    }
    return inline(String(v));
  };
  const chip = (key, item) => {
    if (/^tags?$/i.test(key)) {
      const tag = String(item).replace(/^#/, '');
      return el('a', { class: 'metadata-chip tag', href: '#', text: tag, onclick: (e) => { e.preventDefault(); onTag(tag); } });
    }
    return el('span', { class: 'metadata-chip' }, inline(String(item)));
  };
  const inline = (text) => {
    if (URL_RE.test(text)) return el('a', { class: 'external-link', href: text, text, onclick: (e) => { e.preventDefault(); window.open(text); } });
    const links = parseLinks(text);
    if (!links.length) return el('span', { text });
    const out = [];
    let last = 0;
    for (const link of links) {
      out.push(text.slice(last, link.from));
      const href = link.target + (link.subpath ? `#${link.subpath}` : '');
      out.push(el('a', {
        class: `internal-link${resolve(link.target) ? '' : ' is-unresolved'}`,
        href: '#',
        text: link.alias ?? link.target,
        onclick: (e) => { e.preventDefault(); onLink(href, e); },
      }));
      last = link.to;
    }
    out.push(text.slice(last));
    return el('span', {}, out);
  };
  const entries = Object.entries(data);
  return el('div', { class: 'metadata-container', 'aria-label': 'Propriedades' },
    el('div', { class: 'metadata-title', text: 'Propriedades' }),
    entries.length
      ? entries.map(([key, v]) => el('div', { class: 'metadata-property' },
        el('div', { class: 'metadata-key', text: key }),
        el('div', { class: 'metadata-value' }, value(key, v))))
      : el('div', { class: 'metadata-empty', text: 'Nenhuma propriedade' }));
}
