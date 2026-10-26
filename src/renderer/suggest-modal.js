import { el } from './dom';

const MAX_ITEMS = 100;

// Text box + list chosen with the keyboard, like Obsidian's quick switcher and command palette.
// getItems(query) -> [{ ...anything }], render(item) -> Node, choose(item, event) (event has
// ctrlKey/shiftKey for "new tab"/"create"), instructions: [[keys, text]] shown at the bottom.
export function openSuggest({ placeholder, getItems, render, choose, instructions = [], empty = 'Nada encontrado.' }) {
  const previous = document.activeElement;
  const input = el('input', { class: 'prompt-input', placeholder, spellcheck: 'false', 'aria-label': placeholder });
  const list = el('div', { class: 'prompt-results', role: 'listbox' });
  const dialog = el('dialog', { class: 'prompt' },
    input,
    list,
    instructions.length ? el('div', { class: 'prompt-instructions' }, instructions.map(([keys, text]) => el('span', { class: 'prompt-instruction' },
      el('kbd', { text: keys }), el('span', { text }))))
      : null);
  let items = [];
  let selected = 0;

  const close = () => {
    dialog.close();
    dialog.remove();
    if (previous?.isConnected) previous.focus?.();
  };

  function update() {
    items = getItems(input.value).slice(0, MAX_ITEMS);
    selected = 0;
    list.replaceChildren(...(items.length ? items.map((item, i) => {
      const row = el('div', { class: 'suggestion-item', role: 'option' }, render(item));
      row.addEventListener('mousemove', () => select(i));
      row.addEventListener('click', (event) => accept(i, event));
      return row;
    }) : [el('div', { class: 'suggestion-empty', text: typeof empty === 'function' ? empty(input.value) : empty })]));
    select(0);
  }

  function select(i) {
    if (!items.length) return;
    selected = (i + items.length) % items.length;
    [...list.children].forEach((row, k) => row.classList.toggle('is-selected', k === selected));
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
  }

  function accept(i, event) {
    const item = items[i];
    if (item === undefined && !event.shiftKey) return;
    close();
    choose(item, { ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, query: input.value });
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      select(selected + 1);
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      select(selected - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      accept(selected, event);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    event.stopPropagation();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('mousedown', (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  update();
  return { close, input };
}

// The query's matched characters in bold.
export function highlighted(text, ranges = []) {
  const out = [];
  let last = 0;
  for (const [a, b] of ranges) {
    if (a > last) out.push(text.slice(last, a));
    out.push(el('span', { class: 'suggestion-highlight', text: text.slice(a, b) }));
    last = b;
  }
  out.push(text.slice(last));
  return out;
}
