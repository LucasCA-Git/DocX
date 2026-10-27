import { eventToHotkey, normalizeHotkey } from '../shared/hotkeys';

const STORAGE_KEY = 'docs.hotkeys';

// Every action of the app as a command: the palette lists them, hotkeys run them. A command:
// { id, name, icon?, hotkeys?: ['Mod+P'], check?: () => boolean (available now?), run() }.
// Users can change hotkeys in the settings; overrides are kept per device.
export class Commands extends EventTarget {
  constructor() {
    super();
    this.byId = new Map();
    try {
      this.overrides = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
      this.overrides = {};
    }
  }

  add(command) {
    this.byId.set(command.id, { ...command, hotkeys: (command.hotkeys ?? []).map(normalizeHotkey) });
    this.keymap = null;
  }

  get(id) {
    return this.byId.get(id);
  }

  list() {
    return [...this.byId.values()];
  }

  available() {
    return this.list().filter((c) => !c.check || c.check());
  }

  hotkeysOf(id) {
    return this.overrides[id] ?? this.byId.get(id)?.hotkeys ?? [];
  }

  setHotkeys(id, hotkeys) {
    const normalized = hotkeys.map(normalizeHotkey);
    const defaults = this.byId.get(id)?.hotkeys ?? [];
    if (normalized.join() === defaults.join()) delete this.overrides[id];
    else this.overrides[id] = normalized;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
    } catch {
      // storage unavailable
    }
    this.keymap = null;
    this.dispatchEvent(new Event('change'));
  }

  // Commands that share a hotkey (the settings tab shows the conflict).
  conflicts(hotkey, exceptId) {
    return this.list().filter((c) => c.id !== exceptId && this.hotkeysOf(c.id).includes(hotkey));
  }

  run(id) {
    const command = this.byId.get(id);
    if (!command || (command.check && !command.check())) return false;
    Promise.resolve().then(() => command.run()).catch((err) => this.dispatchEvent(new CustomEvent('error', { detail: err })));
    return true;
  }

  // Global keydown, in the capture phase: app hotkeys win over the editor's own bindings (CodeMirror
  // binds Ctrl+G, Ctrl+I…); keys without an app command still reach the editor.
  // While a modal is open (palette, settings, dialogs) only it handles keys.
  handleKeydown(event) {
    if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
    const hotkey = eventToHotkey(event);
    if (!hotkey) return;
    if (!this.keymap) {
      this.keymap = new Map();
      for (const command of this.list()) {
        for (const hk of this.hotkeysOf(command.id)) this.keymap.set(hk, [...(this.keymap.get(hk) ?? []), command.id]);
      }
    }
    // Several commands may share a key: the first one available now runs.
    const id = (this.keymap.get(hotkey) ?? []).find((cid) => {
      const command = this.byId.get(cid);
      return command && (!command.check || command.check());
    });
    if (id && this.run(id)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

export const commands = new Commands();
