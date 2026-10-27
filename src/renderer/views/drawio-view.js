import { el, displayName, errorText } from '../dom';
import { notice, renderDocStats } from '../status';
import { isLightTheme } from '../appearance';
import { DRAWIO_ORIGIN, drawioEditorUrl } from '../../shared/drawio';
import {
  isDrawioSvg, diagramXmlFromFile, svgFromExportData, withDiagramXml,
} from '../../shared/drawio-file';

const api = window.docs;
const EXPORT_TIMEOUT_MS = 15_000;
const MAX_MESSAGE_CHARS = 50 * 1024 * 1024;

// A diagram (.drawio.svg or .drawio) in the draw.io editor: shape libraries (flowchart, UML, ER,
// BPMN, network, cloud), connectors with routing, swimlanes, layers, pages, templates.
// The editor runs in an iframe on its own origin (docx-drawio://app) and only exchanges JSON
// messages with this view; every message is checked to come from that frame and origin.
export class DrawioView {
  constructor({ workspace, store, path }) {
    this.workspace = workspace;
    this.store = store;
    this.path = path;
    this.dirty = false;
    this.xml = null;
    this.lastSaved = null;
    this.saving = Promise.resolve(true);
    this.exportWaiter = null;

    this.frame = el('iframe', {
      class: 'drawio-frame',
      title: 'Editor de diagramas',
      // Besides its own origin, the editor gets no popups and cannot navigate the app window.
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads',
      referrerpolicy: 'no-referrer',
      src: drawioEditorUrl({ dark: !isLightTheme() }),
    });
    this.titleEl = el('span', { class: 'view-header-title-text' });
    this.el = el('div', { class: 'view drawio-view' },
      el('div', { class: 'view-header' }, el('div', { class: 'view-header-title' }, this.titleEl)),
      el('div', { class: 'view-content drawio-content' }, this.frame));
    this.el.dataset.sourcePath = path;
    this.titleEl.textContent = this.title;
    this.onMessage = (event) => this.handleMessage(event);
    window.addEventListener('message', this.onMessage);
    this.fileText = api.read(path).catch((err) => {
      notice(`Não foi possível abrir o diagrama: ${errorText(err)}`, { error: true });
      return null;
    });
  }

  get type() { return 'drawio'; }

  get title() { return this.path ? displayName(this.path).replace(/\.drawio(\.svg)?$/i, '') : 'Diagrama'; }

  get iconName() { return 'workflow'; }

  post(message) {
    this.frame.contentWindow?.postMessage(JSON.stringify(message), DRAWIO_ORIGIN);
  }

  async handleMessage(event) {
    if (event.source !== this.frame.contentWindow || event.origin !== DRAWIO_ORIGIN || typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_CHARS) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (message?.event) {
      case 'init':
        await this.sendDiagram();
        break;
      case 'autosave':
      case 'save':
        if (typeof message.xml !== 'string') return;
        this.xml = message.xml;
        this.dirty = true;
        this.save();
        break;
      case 'export':
        this.exportWaiter?.resolve(message);
        break;
      default:
    }
  }

  async sendDiagram() {
    const text = await this.fileText;
    if (text === null || this.destroyed) return;
    this.lastSaved = text;
    this.xml = diagramXmlFromFile(text);
    this.post({ action: 'load', xml: this.xml, autosave: 1, title: this.title, noExitBtn: 1, noSaveBtn: 1 });
  }

  // The editable SVG of the current diagram, made by the editor itself.
  requestSvg() {
    this.exportWaiter?.reject(new Error('substituída'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exportWaiter = null;
        reject(new Error('o editor não respondeu à exportação'));
      }, EXPORT_TIMEOUT_MS);
      this.exportWaiter = {
        resolve: (message) => {
          clearTimeout(timer);
          this.exportWaiter = null;
          try {
            resolve(svgFromExportData(message.data));
          } catch (err) {
            reject(err);
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.post({ action: 'export', format: 'xmlsvg', spinKey: null, border: 10 });
    });
  }

  // What goes to disk: the XML itself (.drawio) or the editor's SVG with the XML inside
  // (.drawio.svg). When the editor cannot export (closed tab), the last picture is kept with the
  // newest diagram in it.
  async fileContent(xml) {
    if (!isDrawioSvg(this.path)) return xml;
    if (!this.destroyed) {
      try {
        const svgText = await this.requestSvg();
        if (diagramXmlFromFile(svgText)) return svgText;
      } catch {
        // falls through to the last picture
      }
    }
    return withDiagramXml(this.lastSaved ?? '', xml);
  }

  save() {
    if (!this.dirty || this.xml === null) return this.saving;
    const xml = this.xml;
    const path = this.path;
    this.dirty = false;
    this.saving = this.saving.then(async () => {
      try {
        const text = await this.fileContent(xml);
        await api.write(path, text);
        this.lastSaved = text;
        if (!this.destroyed) this.post({ action: 'status', modified: false });
        return true;
      } catch (err) {
        this.dirty = true;
        notice(`Erro ao salvar o diagrama: ${errorText(err)}`, { error: true });
        return false;
      }
    });
    return this.saving;
  }

  flushed() {
    return this.saving;
  }

  // ---------- workspace contract ----------

  get isDirty() {
    return this.dirty;
  }

  async reloadIfClean() {
    if (this.dirty) return;
    await this.saving;
    const text = await api.read(this.path).catch(() => null);
    if (text === null || text === this.lastSaved || this.dirty) return;
    this.fileText = Promise.resolve(text);
    await this.sendDiagram();
  }

  pathRenamed(from, to) {
    const next = this.path === from ? to : this.path.startsWith(`${from}/`) ? to + this.path.slice(from.length) : this.path;
    if (next === this.path) return;
    this.path = next;
    this.el.dataset.sourcePath = next;
    this.titleEl.textContent = this.title;
  }

  onShow() {
    renderDocStats(null);
  }

  onHide() {
    this.save();
  }

  destroy() {
    this.destroyed = true;
    this.exportWaiter?.reject(new Error('aba fechada'));
    this.save();
    window.removeEventListener('message', this.onMessage);
  }

  serialize() {
    return { type: 'drawio', path: this.path };
  }
}
