import { el, icon, displayName, dirName } from './dom';
import { searchVault } from '../shared/backlinks-search';

const SEARCH_DELAY_MS = 150;

// Left sidebar search: text in every note (case and accents ignored), hits grouped by note;
// clicking a hit opens the note at that place.
export class SearchPane {
  constructor({ workspace, store, rootEl }) {
    this.workspace = workspace;
    this.store = store;
    this.input = el('input', { class: 'search-input', type: 'search', placeholder: 'Buscar no vault…', spellcheck: 'false' });
    this.caseSensitive = false;
    this.caseBtn = el('button', {
      class: 'clickable-icon search-case',
      title: 'Diferenciar maiúsculas',
      'aria-pressed': 'false',
      text: 'Aa',
      onclick: () => {
        this.caseSensitive = !this.caseSensitive;
        this.caseBtn.classList.toggle('is-active', this.caseSensitive);
        this.caseBtn.setAttribute('aria-pressed', String(this.caseSensitive));
        this.schedule();
      },
    });
    this.helpBtn = el('button', { class: 'clickable-icon', title: 'Sintaxe da busca', onclick: () => this.showHelp() }, icon('help', 16));
    this.results = el('div', { class: 'search-results' });
    // Folded (lower case, no accents) note texts, reused while a note is unchanged.
    this.cache = new Map();
    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.results.querySelector('.result-line, .result-title')?.click();
    });
    rootEl.append(el('div', { class: 'search-row' }, this.input, this.caseBtn, this.helpBtn), this.results);
    store.addEventListener('change', () => this.schedule());
    store.addEventListener('links', () => this.schedule());
  }

  setQuery(query) {
    this.input.value = query;
    this.render();
  }

  showHelp() {
    const rows = [
      ['palavra outra', 'as duas palavras, em qualquer ordem'],
      ['"frase exata"', 'o texto exatamente assim'],
      ['-palavra', 'exclui notas com a palavra'],
      ['a OR b', 'uma ou outra'],
      ['tag:#projeto', 'notas com a tag (e subtags)'],
      ['path:pasta', 'caminho contém'],
      ['file:nome', 'nome do arquivo contém'],
      ['/regex/', 'expressão regular'],
    ];
    this.results.replaceChildren(el('div', { class: 'search-help' }, rows.map(([q, d]) => el('div', { class: 'search-help-row', onclick: () => this.setQuery(q) }, el('code', { text: q }), el('span', { text: d })))));
  }

  focus() {
    this.input.focus();
    this.input.select();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.render(), SEARCH_DELAY_MS);
  }

  render() {
    const query = this.input.value;
    if (!query.trim()) {
      this.results.replaceChildren();
      return;
    }
    for (const rel of this.cache.keys()) if (!this.store.texts.has(rel)) this.cache.delete(rel);
    const found = searchVault(this.store.texts, query, {
      cache: this.cache,
      caseSensitive: this.caseSensitive,
      tagsOf: (path) => this.store.index.tagsOf(path),
    });
    const partial = found.timedOut ? el('p', { class: 'pane-empty', text: 'Busca interrompida: a expressão demorou demais. Resultados parciais.' }) : null;
    if (!found.length) {
      this.results.replaceChildren(el('p', { class: 'pane-empty', text: 'Nada encontrado.' }), ...(partial ? [partial] : []));
      return;
    }
    const open = (path, event, reveal = null) => this.workspace.openFile(path, { newTab: event.ctrlKey || event.metaKey, reveal });
    this.results.replaceChildren(
      el('div', { class: 'pane-header' }, el('span', { text: `${found.length} ${found.length === 1 ? 'nota' : 'notas'}` })),
      ...(partial ? [partial] : []),
      ...found.map(({ path, total, matches }) => el('div', { class: 'result-group' },
        el('div', { class: 'result-title', title: path, onclick: (event) => open(path, event) },
          el('span', { text: displayName(path) }),
          dirName(path) ? el('span', { class: 'result-folder', text: dirName(path) }) : null,
          total ? el('span', { class: 'pane-count', text: String(total) }) : null),
        ...matches.map((m) => el('div', { class: 'result-line', onclick: (event) => open(path, event, { line: m.line, from: m.from, to: m.to }) },
          m.text.slice(Math.max(0, m.from - 40), m.from),
          el('mark', { text: m.text.slice(m.from, m.to) }),
          m.text.slice(m.to, m.to + 80))))),
    );
  }
}
