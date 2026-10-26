import { el, icon } from './dom';

let open = null;

function close() {
  open?.remove();
  open = null;
}

window.addEventListener('mousedown', (event) => {
  if (open && !open.contains(event.target)) close();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
});
window.addEventListener('blur', close);

// items: [{ label, icon, action, danger }] or '-' for a separator.
export function showMenu(items, x, y) {
  close();
  const menu = el('div', { class: 'menu', role: 'menu' }, items.map((item) => (item === '-'
    ? el('div', { class: 'menu-separator' })
    : el('div', {
      class: `menu-item${item.danger ? ' is-danger' : ''}`,
      role: 'menuitem',
      onclick: () => {
        close();
        item.action();
      },
    }, item.icon ? icon(item.icon, 16) : el('span', { class: 'menu-icon-spacer' }), el('span', { text: item.label })))));
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  open = menu;
}
