import { el, icon } from './dom';

// A group of tabs with the view of the active one (a "tab group"). The workspace holds
// a tree of these: split = { type: 'split', dir: 'row'|'column', children: [node], sizes: [n] }.
export class Pane {
  constructor(workspace) {
    this.workspace = workspace;
    this.views = [];
    this.active = null;
    this.tabsEl = el('div', { class: 'pane-tabs' });
    this.extrasEl = el('div', { class: 'pane-tabbar-extras' });
    this.headerEl = el('div', { class: 'pane-tabbar' },
      this.tabsEl,
      el('button', { class: 'clickable-icon pane-new-tab', title: 'Nova aba (Ctrl+T)', 'aria-label': 'Nova aba', onclick: () => workspace.newTab(this) }, icon('plus', 16)),
      el('div', { class: 'pane-tabbar-spacer' }),
      this.extrasEl);
    this.container = el('div', { class: 'view-container' });
    this.el = el('div', { class: 'workspace-pane' }, this.headerEl, this.container);
    // Clicking anywhere in a pane makes it the one new files open in.
    this.el.addEventListener('mousedown', () => workspace.focusPane(this), true);
  }

  get type() { return 'pane'; }

  show(view) {
    this.container.replaceChildren(view.el);
  }

  renderTabs() {
    this.tabsEl.replaceChildren(...this.views.map((view) => {
      const tab = el('div', {
        class: `tab${view === this.active ? ' is-active' : ''}${view.pinned ? ' is-pinned' : ''}`,
        title: view.path ?? view.title,
        draggable: 'true',
        onmousedown: (event) => {
          if (event.button === 1) {
            event.preventDefault();
            if (!view.pinned) this.workspace.closeView(view);
          } else if (event.button === 0) {
            this.workspace.activate(view);
          }
        },
        oncontextmenu: (event) => {
          event.preventDefault();
          this.workspace.tabMenu(view, event.clientX, event.clientY);
        },
      },
      icon(view.iconName, 14),
      el('span', { class: 'tab-title', text: view.title }),
      view.pinned
        ? el('button', { class: 'tab-close tab-pin', title: 'Desafixar', onmousedown: (e) => e.stopPropagation(), onclick: () => this.workspace.togglePin(view) }, icon('pin', 13))
        : el('button', {
          class: 'tab-close',
          title: 'Fechar (Ctrl+W)',
          onmousedown: (event) => event.stopPropagation(),
          onclick: () => this.workspace.closeView(view),
        }, icon('x', 14)));
      // Drag a tab to reorder it, or onto another pane's tab bar to move it there.
      tab.addEventListener('dragstart', (event) => {
        this.workspace.draggedView = view;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-docs-tab', '1');
      });
      const isTabDrag = (event) => this.workspace.draggedView && event.dataTransfer.types.includes('application/x-docs-tab');
      tab.addEventListener('dragover', (event) => {
        if (!isTabDrag(event)) return;
        event.preventDefault();
        tab.classList.add('is-drop-target');
      });
      tab.addEventListener('dragleave', () => tab.classList.remove('is-drop-target'));
      tab.addEventListener('drop', (event) => {
        if (!isTabDrag(event)) return;
        event.preventDefault();
        tab.classList.remove('is-drop-target');
        this.workspace.moveView(this.workspace.draggedView, this, this.views.indexOf(view));
      });
      return tab;
    }));
    const tabDrag = (event) => this.workspace.draggedView && event.dataTransfer.types.includes('application/x-docs-tab');
    this.tabsEl.ondragover = (event) => {
      if (tabDrag(event)) event.preventDefault();
    };
    this.tabsEl.ondrop = (event) => {
      if (event.target !== this.tabsEl || !tabDrag(event)) return;
      event.preventDefault();
      this.workspace.moveView(this.workspace.draggedView, this, this.views.length);
    };
  }
}

export const isSplit = (node) => node?.type === 'split';

// All panes, left-to-right / top-to-bottom.
export function panesOf(node) {
  return isSplit(node) ? node.children.flatMap(panesOf) : [node];
}

export function parentOf(root, target) {
  if (!isSplit(root)) return null;
  for (const child of root.children) {
    if (child === target) return root;
    const found = parentOf(child, target);
    if (found) return found;
  }
  return null;
}

// DOM for the tree. Panes touching the top edge carry the window's title bar (draggable); the one
// in the top-right corner leaves room for the window buttons and gets `extras` (sidebar toggle).
export function renderLayout(root, { extras, onResize }) {
  const build = (node, atTop, atRight) => {
    if (!isSplit(node)) {
      node.headerEl.classList.toggle('titlebar-drag', atTop);
      node.headerEl.classList.toggle('is-top-right', atTop && atRight);
      node.extrasEl.replaceChildren(...(atTop && atRight ? extras() : []));
      return node.el;
    }
    const box = el('div', { class: `workspace-split mod-${node.dir}` });
    node.sizes ??= node.children.map(() => 1);
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      const childEl = build(child, atTop && (node.dir === 'row' || i === 0), atRight && (node.dir === 'column' || last));
      childEl.style.flex = `${node.sizes[i]} 1 0`;
      box.append(childEl);
      if (!last) box.append(resizeHandle(node, i, box, onResize));
    });
    return box;
  };
  return build(root, true, true);
}

function resizeHandle(split, index, box, onResize) {
  const handle = el('div', { class: `workspace-resize mod-${split.dir}` });
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const items = [...box.children].filter((c) => !c.classList.contains('workspace-resize'));
    const a = items[index].getBoundingClientRect();
    const b = items[index + 1].getBoundingClientRect();
    const horizontal = split.dir === 'row';
    const start = horizontal ? event.clientX : event.clientY;
    const sizeA = horizontal ? a.width : a.height;
    const sizeB = horizontal ? b.width : b.height;
    const total = split.sizes[index] + split.sizes[index + 1];
    const move = (e) => {
      const delta = (horizontal ? e.clientX : e.clientY) - start;
      const newA = Math.max(120, Math.min(sizeA + sizeB - 120, sizeA + delta));
      if (!(sizeA + sizeB > 0)) return;
      split.sizes[index] = (total * newA) / (sizeA + sizeB);
      split.sizes[index + 1] = total - split.sizes[index];
      items[index].style.flex = `${split.sizes[index]} 1 0`;
      items[index + 1].style.flex = `${split.sizes[index + 1]} 1 0`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      onResize();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  return handle;
}
