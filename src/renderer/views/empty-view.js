import { el } from '../dom';
import { renderDocStats } from '../status';

// "Nova aba": what a tab shows when no file is open in it.
export class EmptyView {
  constructor({ workspace }) {
    const action = (text, onclick) => el('button', { class: 'empty-state-action', text, onclick });
    this.el = el('div', { class: 'view empty-view' },
      el('div', { class: 'view-header' }),
      el('div', { class: 'view-content empty-state' },
        el('div', { class: 'empty-state-title', text: 'Nenhum arquivo aberto' }),
        action('Criar nova nota (Ctrl+N)', () => workspace.createNote()),
        action('Abrir visualização em gráfico (Ctrl+G)', () => workspace.openGraph()),
        action('Fechar', () => workspace.closeView(this))));
  }

  get type() { return 'empty'; }

  get title() { return 'Nova aba'; }

  get iconName() { return 'file-text'; }

  onShow() { renderDocStats(null); }

  onHide() {}

  destroy() {}

  serialize() { return { type: 'empty' }; }
}
