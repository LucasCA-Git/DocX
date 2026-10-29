import { $, el, icon, errorText } from './dom';
import { prefs, PREF_SECTIONS } from './prefs';

const api = window.docs;

// Settings modal with tabs on the left. "Vault e sincronização" saves to the main
// process (it reopens the vault); the other tabs are preferences applied at once.
// extraSections: [{ id, title, render(container) }] added by other modules (hotkeys…).
export function setupSettings({ beforeSave, onSaved, extraSections = [] }) {
  const dialog = $('#settings');
  const nav = $('#settings-nav');
  const body = $('#settings-body');
  const sections = [
    { id: 'vault', title: 'Vault e sincronização', render: renderVault },
    ...PREF_SECTIONS.map((section) => ({ ...section, render: (host) => renderPrefs(host, section) })),
    ...extraSections,
  ];
  let current = 'vault';
  let renderToken = 0;

  $('#settings-close').append(icon('x'));
  $('#settings-close').addEventListener('click', () => dialog.close());

  function show(id) {
    current = id;
    nav.replaceChildren(...sections.map((s) => el('div', {
      class: `settings-nav-item${s.id === id ? ' is-active' : ''}`,
      text: s.title,
      onclick: () => show(s.id),
    })));
    const section = sections.find((s) => s.id === id) ?? sections[0];
    body.replaceChildren(el('h2', { text: section.title }));
    section.render(body, ++renderToken);
  }

  function renderPrefs(host, section) {
    for (const item of section.items) {
      const value = prefs.get(item.key);
      let control;
      if (item.type === 'toggle') {
        control = el('input', { type: 'checkbox', class: 'toggle', 'aria-label': item.label });
        control.checked = value;
        control.addEventListener('change', () => prefs.set(item.key, control.checked));
      } else if (item.type === 'select') {
        control = el('select', { 'aria-label': item.label }, item.options.map(([v, label]) => el('option', { value: v, text: label })));
        control.value = value;
        control.addEventListener('change', () => prefs.set(item.key, control.value));
      } else if (item.type === 'number') {
        control = el('input', { type: 'number', min: item.min, max: item.max, class: 'setting-number', 'aria-label': item.label });
        control.value = value;
        control.addEventListener('change', () => {
          const n = Math.min(item.max, Math.max(item.min, Number(control.value) || item.min));
          control.value = n;
          prefs.set(item.key, n);
        });
      } else if (item.type === 'color') {
        control = el('input', { type: 'color', class: 'setting-color', 'aria-label': item.label });
        control.value = value;
        control.addEventListener('input', () => prefs.set(item.key, control.value));
      } else {
        control = el('input', { type: 'text', spellcheck: 'false', class: 'setting-text', 'aria-label': item.label });
        control.value = value;
        control.addEventListener('change', () => prefs.set(item.key, control.value.trim()));
      }
      host.append(settingRow(item.label, item.desc, control));
    }
  }

  async function renderVault(host, token) {
    const cfg = await api.getConfig();
    if (current !== 'vault' || token !== renderToken) return;
    const input = (name, props = {}) => {
      const node = el('input', { name, spellcheck: 'false', ...props });
      node.value = cfg[name] ?? '';
      return node;
    };
    const vaultPath = input('vaultPath', { required: true });
    const provider = el('select', { name: 'syncProvider' },
      el('option', { value: 'git', text: 'Git (GitHub, GitLab…)' }),
      el('option', { value: 'none', text: 'Nenhuma (só neste computador)' }));
    provider.value = cfg.syncProvider ?? 'git';
    const gitBox = el('div', { class: 'settings-group' },
      settingRow('URL do repositório', 'Crie um repositório privado vazio (ex.: no GitHub) e cole a URL: https://github.com/voce/notas.git ou git@github.com:voce/notas.git. O login é feito pelo Git (Git Credential Manager ou sua chave SSH); o app nunca vê a senha.', input('gitUrl', { placeholder: 'https://github.com/voce/notas.git', class: 'setting-wide' })),
      settingRow('Branch', null, input('gitBranch', { placeholder: 'main' })));
    const sync = () => {
      gitBox.hidden = provider.value !== 'git';
    };
    provider.addEventListener('change', sync);
    sync();
    const error = el('p', { class: 'error', hidden: true });
    const form = el('form', { class: 'settings-form' },
      settingRow('Pasta das notas', 'Uma pasta comum no seu computador; abre em qualquer editor Markdown.',
        el('span', { class: 'row' }, vaultPath, el('button', {
          type: 'button',
          text: 'Escolher…',
          onclick: async () => {
            const folder = await api.chooseFolder();
            if (folder) vaultPath.value = folder;
          },
        }))),
      settingRow('Sincronização', null, provider),
      gitBox,
      error,
      el('div', { class: 'buttons' }, el('button', { type: 'submit', class: 'mod-cta', text: 'Salvar' })));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      try {
        await beforeSave();
        const saved = await api.saveConfig(data);
        dialog.close();
        await onSaved(saved);
      } catch (err) {
        error.textContent = errorText(err);
        error.hidden = false;
      }
    });
    host.append(form);
  }

  return function openSettings(id = 'vault') {
    show(id);
    if (!dialog.open) dialog.showModal();
  };
}

export function settingRow(label, desc, control) {
  return el('div', { class: 'setting-item' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name', text: label }),
      desc ? el('div', { class: 'setting-desc', text: desc }) : null),
    el('div', { class: 'setting-control' }, control));
}
