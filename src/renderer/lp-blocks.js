import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { parseFrontMatter } from '../shared/metadata';
import { markdownBlocks } from '../shared/markdown-extras';
import { renderProperties } from './properties';
import { renderMarkdown } from './markdown';
import { enhanceRendered, renderMath, renderMermaid } from './render-extras';

// Above this size the whole-document scan per keystroke is not worth it: blocks show as text.
const MAX_SCAN = 300_000;

// Live Preview pieces that replace whole blocks (several lines). CodeMirror only accepts those
// from a state field, not from a view plugin.

class PropertiesWidget extends WidgetType {
  constructor(data, handlers) {
    super();
    this.data = data;
    this.json = JSON.stringify(data);
    this.handlers = handlers;
  }

  eq(other) {
    return other.json === this.json;
  }

  // Clicking the table (anywhere but a link or tag) opens the YAML for editing.
  toDOM(view) {
    const dom = renderProperties(this.data, this.handlers);
    dom.classList.add('cm-lp-properties');
    dom.addEventListener('mousedown', (event) => {
      if (event.target.closest('a')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: Math.min(4, view.state.doc.length) } });
      view.focus();
    });
    return dom;
  }

  ignoreEvent() {
    return true;
  }
}

// Front matter shown as a properties table while the cursor is outside it.
export function propertiesField(handlers) {
  const build = (state) => {
    const text = state.doc.sliceString(0, Math.min(state.doc.length, 64 * 1024));
    const fm = parseFrontMatter(text);
    if (!fm.data) return Decoration.none;
    const { head } = state.selection.main;
    if (head <= fm.to) return Decoration.none;
    return Decoration.set([Decoration.replace({ widget: new PropertiesWidget(fm.data, handlers), block: true }).range(0, fm.to)]);
  };
  return StateField.define({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}

// Tables, $$ math and ```mermaid rendered while the cursor is outside them; clicking one puts the
// cursor on its first line, which shows the Markdown again.
class BlockWidget extends WidgetType {
  constructor(block, source, resolve) {
    super();
    this.block = block;
    this.source = source;
    this.resolve = resolve;
  }

  eq(other) {
    return other.block.type === this.block.type && other.source === this.source;
  }

  toDOM(view) {
    const dom = document.createElement('div');
    dom.className = `cm-lp-block cm-lp-${this.block.type}`;
    if (this.block.type === 'table') {
      dom.classList.add('markdown-reading');
      dom.innerHTML = renderMarkdown(this.source, this.resolve);
      enhanceRendered(dom);
    } else if (this.block.type === 'math') {
      renderMath(dom, this.block.content, true);
    } else {
      renderMermaid(dom, this.block.content);
    }
    dom.addEventListener('mousedown', (event) => {
      if (event.target.closest('a')) return;
      event.preventDefault();
      // The DOM may be reused after text above moved the block: ask the view where it is now.
      const line = view.state.doc.lineAt(Math.min(view.posAtDOM(dom), view.state.doc.length));
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });
    return dom;
  }

  ignoreEvent() {
    return true;
  }
}

export function blocksField({ resolve }) {
  const build = (state) => {
    if (state.doc.length > MAX_SCAN) return Decoration.none;
    const text = state.doc.toString();
    const ranges = [];
    const { from: selFrom, to: selTo } = state.selection.main;
    for (const block of markdownBlocks(text)) {
      if (selTo >= block.from && selFrom <= block.to) continue;
      ranges.push(Decoration.replace({ widget: new BlockWidget(block, text.slice(block.from, block.to), resolve), block: true }).range(block.from, block.to));
    }
    return Decoration.set(ranges, true);
  };
  return StateField.define({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}
