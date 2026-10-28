import { $, el, icon, errorText } from './dom';

// Toasts (notices) in the top-right corner.
export function notice(message, { error = false, timeout = 6000 } = {}) {
  const node = el('div', { class: `notice${error ? ' is-error' : ''}`, text: errorText(message) });
  node.addEventListener('click', () => node.remove());
  $('#notices').append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
}

// In-app confirmation. window.confirm() is avoided on purpose: in Electron on Windows the native
// dialog leaves the page without keyboard focus, so nothing can be typed until the window is
// refocused.
export function confirmDialog(message, { confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = el('dialog', { class: 'modal-confirm' });
    const done = (answer) => {
      dialog.close();
      dialog.remove();
      previous?.focus?.();
      resolve(answer);
    };
    const ok = el('button', { class: danger ? 'mod-warning' : 'mod-cta', text: confirmLabel, onclick: () => done(true) });
    dialog.append(
      el('p', { text: message }),
      el('div', { class: 'buttons' }, el('button', { text: 'Cancelar', onclick: () => done(false) }), ok),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      done(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}

let lastError = null;

// In-app text prompt (window.prompt does not exist in Electron). Resolves to the text or null.
export function promptDialog(message, { placeholder = '', value = '', confirmLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const input = el('input', { placeholder, spellcheck: 'false' });
    input.value = value;
    const dialog = el('dialog', { class: 'modal-confirm' });
    const done = (answer) => {
      dialog.close();
      dialog.remove();
      previous?.focus?.();
      resolve(answer);
    };
    const form = el('form', { method: 'dialog' },
      el('p', { text: message }),
      input,
      el('div', { class: 'buttons' },
        el('button', { type: 'button', text: 'Cancelar', onclick: () => done(null) }),
        el('button', { type: 'submit', class: 'mod-cta', text: confirmLabel })));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      done(input.value.trim() || null);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      done(null);
    });
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}

export function renderSyncStatus(status) {
  const node = $('#sync-status');
  node.className = 'status-item';
  node.title = '';
  let name = 'cloud-off';
  let text = 'Sync desligado';
  switch (status.state) {
    case 'syncing':
      name = 'refresh';
      text = 'Sincronizando…';
      node.classList.add('is-syncing');
      break;
    case 'idle':
      lastError = null;
      name = 'cloud';
      text = 'Sincronizado';
      node.title = `Git sincronizado às ${new Date(status.at).toLocaleTimeString()}`;
      node.classList.add('is-ok');
      break;
    case 'error':
      name = 'warning';
      text = 'Erro no sync';
      node.title = status.message ?? '';
      node.classList.add('is-error');
      // The timer retries every 30 s: the same error (e.g. offline) is announced only once.
      if (status.message !== lastError) notice(status.message ?? 'Erro de sincronização', { error: true });
      lastError = status.message;
      break;
    default:
      if (status.message) node.title = status.message;
  }
  node.replaceChildren(icon(name, 14), el('span', { text }));
}

export function renderDocStats(text) {
  if (text === null) {
    $('#doc-stats').textContent = '';
    return;
  }
  const words = (text.match(/[\p{L}\p{N}_'-]+/gu) ?? []).length;
  $('#doc-stats').textContent = `${words} ${words === 1 ? 'palavra' : 'palavras'} · ${text.length} caracteres`;
}
