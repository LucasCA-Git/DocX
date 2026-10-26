import { el, icon } from './dom';
import { commands } from './commands';
import { eventToHotkey, formatHotkey } from '../shared/hotkeys';
import { fuzzySort } from '../shared/fuzzy';

// One recorder at a time; cancelled when another "+" is clicked or the settings close.
let stopRecording = null;
const NEEDS_NO_MODIFIER = /^(F\d{1,2}|Escape|Delete|Insert|Home|End|PageUp|PageDown)$/;

// "Atalhos" tab of the settings: every command with its hotkeys; add one by pressing it, remove
// with ×, restore the default.
export const hotkeysSection = {
  id: 'hotkeys',
  title: 'Atalhos de teclado',
  render(host) {
    const filter = el('input', { class: 'hotkeys-filter', placeholder: 'Filtrar comandos…', spellcheck: 'false' });
    const list = el('div', { class: 'hotkeys-list' });
    const render = () => {
      const all = commands.list().sort((a, b) => a.name.localeCompare(b.name));
      const shown = filter.value.trim() ? fuzzySort(filter.value, all, (c) => c.name).map((r) => r.item) : all;
      list.replaceChildren(...shown.map(row));
    };
    const row = (command) => {
      const keys = commands.hotkeysOf(command.id);
      const isDefault = keys.join() === command.hotkeys.join();
      const record = el('button', { class: 'clickable-icon', title: 'Adicionar atalho', 'aria-label': 'Adicionar atalho' }, icon('plus', 14));
      record.addEventListener('click', () => {
        stopRecording?.();
        record.replaceChildren(el('span', { class: 'hotkey-recording', text: 'Pressione o atalho (com Ctrl/Alt)…' }));
        const dialog = host.closest('dialog');
        const onKey = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') return done();
          const hotkey = eventToHotkey(event);
          if (!hotkey) return;
          // A plain letter as a hotkey would fire while typing.
          if (!/^(Mod|Alt)\+/.test(hotkey) && !NEEDS_NO_MODIFIER.test(hotkey)) return;
          commands.setHotkeys(command.id, [...keys.filter((k) => k !== hotkey), hotkey]);
          done();
        };
        const done = () => {
          window.removeEventListener('keydown', onKey, true);
          dialog?.removeEventListener('close', done);
          stopRecording = null;
          if (host.isConnected) render();
        };
        stopRecording = done;
        window.addEventListener('keydown', onKey, true);
        dialog?.addEventListener('close', done);
      });
      return el('div', { class: 'setting-item' },
        el('div', { class: 'setting-info' }, el('div', { class: 'setting-name', text: command.name })),
        el('div', { class: 'setting-control hotkey-control' },
          keys.map((hk) => {
            const conflict = commands.conflicts(hk, command.id).length > 0;
            return el('kbd', { class: `hotkey${conflict ? ' is-conflict' : ''}`, title: conflict ? 'Este atalho também é usado por outro comando' : '' },
              formatHotkey(hk),
              el('button', { class: 'hotkey-remove', title: 'Remover', 'aria-label': `Remover ${formatHotkey(hk)}`, onclick: () => { commands.setHotkeys(command.id, keys.filter((k) => k !== hk)); render(); } }, icon('x', 12)));
          }),
          isDefault ? null : el('button', { class: 'clickable-icon', title: 'Restaurar padrão', onclick: () => { commands.setHotkeys(command.id, command.hotkeys); render(); } }, icon('refresh', 14)),
          record));
    };
    filter.addEventListener('input', render);
    host.append(filter, list);
    render();
  },
};
