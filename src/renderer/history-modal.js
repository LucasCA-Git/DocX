import { el, icon, displayName, errorText } from './dom';
import { diffLines } from '../shared/diff';
import { renderMarkdown } from './markdown';
import { enhanceRendered } from './render-extras';
import { confirmDialog, notice } from './status';

const api = window.docs;

const formatDate = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Version history of one note (its Git commits): list on the left, the chosen version on the right
// as a diff against the current text or as rendered text, and "restore" (an undoable edit).
export async function openHistory({ path, currentText, restore, resolve }) {
  let versions;
  try {
    versions = await api.history(path);
  } catch (err) {
    notice(err, { error: true });
    return;
  }
  if (!versions.length) {
    notice(`"${displayName(path)}" ainda não tem versões salvas no Git (a primeira aparece depois da próxima sincronização).`);
    return;
  }
  const list = el('div', { class: 'history-list' });
  const content = el('div', { class: 'history-content' });
  const modeButtons = {};
  let mode = 'diff';
  let selected = null;
  let selectedText = null;

  const restoreBtn = el('button', { class: 'mod-cta', text: 'Restaurar esta versão', disabled: true });
  const dialog = el('dialog', { class: 'modal-history', 'aria-label': 'Histórico de versões' },
    el('div', { class: 'history-header' },
      el('h2', { text: `Histórico de "${displayName(path)}"` }),
      el('button', { class: 'clickable-icon', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => dialog.close() }, icon('x'))),
    el('div', { class: 'history-main' }, list,
      el('div', { class: 'history-right' },
        el('div', { class: 'history-toolbar' },
          ...['diff', 'text'].map((m) => {
            modeButtons[m] = el('button', { class: 'history-mode', text: m === 'diff' ? 'Diferenças para a atual' : 'Texto da versão', onclick: () => setMode(m) });
            return modeButtons[m];
          }),
          el('span', { class: 'spacer' }),
          restoreBtn),
        content)));
  dialog.addEventListener('close', () => dialog.remove());

  function setMode(m) {
    mode = m;
    for (const [key, btn] of Object.entries(modeButtons)) btn.classList.toggle('is-active', key === m);
    renderContent();
  }

  function renderContent() {
    if (selectedText === null) {
      content.replaceChildren(el('p', { class: 'pane-empty', text: selected ? 'A nota não existia nesta versão.' : '' }));
      return;
    }
    if (mode === 'text') {
      const article = el('article', { class: 'markdown-reading' });
      article.innerHTML = renderMarkdown(selectedText, resolve);
      enhanceRendered(article);
      content.replaceChildren(article);
      return;
    }
    const parts = diffLines(selectedText, currentText());
    if (parts.every((p) => p.type === 'equal')) {
      content.replaceChildren(el('p', { class: 'pane-empty', text: 'Igual à versão atual.' }));
      return;
    }
    content.replaceChildren(el('pre', { class: 'history-diff' }, parts.map((p) => el('div', {
      class: `diff-line diff-${p.type}`,
      text: `${p.type === 'added' ? '+ ' : p.type === 'removed' ? '− ' : '  '}${p.text}`,
    }))));
  }

  async function select(version, item) {
    for (const node of list.children) node.classList.toggle('is-active', node === item);
    selected = version;
    restoreBtn.disabled = true;
    try {
      const text = await api.readVersion(version.sha, version.path);
      if (selected !== version) return;
      selectedText = text;
      restoreBtn.disabled = text === null;
    } catch (err) {
      if (selected !== version) return;
      selectedText = null;
      notice(err, { error: true });
    }
    renderContent();
  }

  list.append(...versions.map((version, i) => {
    const item = el('div', { class: 'history-item', tabindex: '0' },
      el('div', { class: 'history-date', text: formatDate(version.at) + (i === 0 ? ' · mais recente' : '') }),
      el('div', { class: 'history-meta', text: version.path !== path ? `como "${displayName(version.path)}"` : version.subject.replace(/^vault: [\d-]+ [\d:]+ /, '') }));
    item.addEventListener('click', () => select(version, item));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') select(version, item);
    });
    return item;
  }));

  restoreBtn.addEventListener('click', async () => {
    if (selectedText === null) return;
    const ok = await confirmDialog(`Substituir o texto atual pela versão de ${formatDate(selected.at)}? Dá para desfazer com Ctrl+Z.`, { confirmLabel: 'Restaurar' });
    if (!ok) return;
    try {
      await restore(selectedText);
      dialog.close();
      notice('Versão restaurada.');
    } catch (err) {
      notice(errorText(err), { error: true });
    }
  });

  document.body.append(dialog);
  setMode('diff');
  dialog.showModal();
  select(versions[0], list.firstChild);
}
