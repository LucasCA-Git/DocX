import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { livePreview } from '../shared/live-preview';
import { parseLinks } from '../shared/links';
import { parseTags } from '../shared/metadata';
import { assetUrl } from '../shared/asset-url';
import { el, IMAGE_FILE } from './dom';
import { renderMath } from './render-extras';

// Dispatched when the vault's file list changed, so links re-check whether their target exists.
export const refreshLivePreview = StateEffect.define();

const SIZE_RE = /^(\d+)(?:x(\d+))?$/;

class WikilinkWidget extends WidgetType {
  constructor(label, href, resolved, open) {
    super();
    Object.assign(this, { label, href, resolved, open });
  }

  eq(other) {
    return other.label === this.label && other.href === this.href && other.resolved === this.resolved;
  }

  toDOM() {
    return el('span', {
      class: `cm-lp-wikilink${this.resolved ? '' : ' is-unresolved'}`,
      text: this.label,
      title: this.href,
      role: 'link',
      onmousedown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.open(this.href, { newTab: event.ctrlKey || event.metaKey });
      },
    });
  }

  // Clicks open the link; the editor must not also move the cursor into it.
  ignoreEvent() {
    return true;
  }
}

class EmbedWidget extends WidgetType {
  constructor(target, subpath, alias, resolved, embedNote, version) {
    super();
    Object.assign(this, { target, subpath, alias, resolved, embedNote, version });
  }

  eq(other) {
    return other.target === this.target && other.subpath === this.subpath && other.alias === this.alias
      && other.resolved === this.resolved && other.version === this.version;
  }

  toDOM() {
    if (!this.resolved) return el('span', { class: 'cm-lp-embed is-unresolved', text: `"${this.target}" não foi encontrado.` });
    if (/\.(md|markdown|txt)$/i.test(this.resolved)) {
      const box = this.embedNote(this.resolved, this.subpath);
      box.classList.add('cm-lp-note-embed');
      return box;
    }
    if (!IMAGE_FILE.test(this.resolved)) return el('span', { class: 'cm-lp-wikilink', text: this.alias || this.target });
    const size = this.alias?.match(SIZE_RE);
    return el('span', { class: 'cm-lp-embed' }, el('img', {
      src: assetUrl(this.resolved),
      alt: size ? this.target : this.alias || this.target,
      width: size?.[1],
      height: size?.[2],
    }));
  }
}

EmbedWidget.prototype.ignoreEvent = function ignoreEvent() {
  // Clicks inside an embedded note (its links, its title) are handled by the embed itself.
  return Boolean(this.resolved && /\.(md|markdown|txt)$/i.test(this.resolved));
};

class MathWidget extends WidgetType {
  constructor(tex) {
    super();
    this.tex = tex;
  }

  eq(other) {
    return other.tex === this.tex;
  }

  toDOM() {
    const span = el('span', { class: 'cm-lp-math' });
    renderMath(span, this.tex, false);
    return span;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    return el('span', { class: 'cm-lp-bullet', text: '•' });
  }
}

class TaskWidget extends WidgetType {
  constructor(checked, marker) {
    super();
    Object.assign(this, { checked, marker });
  }

  eq(other) {
    return other.checked === this.checked && other.marker === this.marker;
  }

  // Ticking writes [x] / [ ] in the text, so the note stays plain Markdown. `click` also covers
  // Space on a focused checkbox; the text is checked first in case the offset is stale.
  toDOM(view) {
    const box = el('input', { type: 'checkbox', class: 'cm-lp-task', checked: this.checked, 'aria-label': 'Tarefa concluída' });
    box.addEventListener('mousedown', (event) => event.preventDefault());
    box.addEventListener('click', (event) => {
      event.preventDefault();
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(this.marker, this.marker + 3))) return;
      view.dispatch({ changes: { from: this.marker + 1, to: this.marker + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    return el('span', { class: 'cm-lp-hr' });
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

// Lines touched by a selection show their raw Markdown; everything else is formatted. Without
// focus no line is raw, so a note read in a background tab looks finished.
function activeTest(view) {
  if (!view.hasFocus) return () => false;
  const { doc } = view.state;
  const lines = view.state.selection.ranges.map((r) => [doc.lineAt(r.from).from, doc.lineAt(r.to).to]);
  return (from, to) => lines.some(([a, b]) => from <= b && to >= a);
}

// resolve(target) → vault path or null; open(href, { newTab }) follows a link.
export function livePreviewPlugin({ resolve, open, embedNote, version }) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.doc = null;
      this.decorations = this.build(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
        || syntaxTree(update.startState) !== syntaxTree(update.state)
        || update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLivePreview)))) {
        this.decorations = this.build(update.view);
      }
    }

    // A model bug must not take the plugin down (CodeMirror disables a plugin that throws): the
    // note then just shows plain text.
    build(view) {
      try {
        return this.decorate(view);
      } catch (err) {
        console.error('Live Preview', err);
        return Decoration.none;
      }
    }

    decorate(view) {
      const { state } = view;
      if (this.doc !== state.doc) {
        this.doc = state.doc;
        this.text = state.doc.toString();
        this.links = parseLinks(this.text);
        this.tags = null;
      }
      // Tags inside code (indented blocks, HTML, fences the line scan misses) are dropped using the
      // syntax tree, which may still be growing: recomputed on every build.
      const tree = syntaxTree(state);
      this.tags = parseTags(this.text).filter((t) => {
        for (let node = tree.resolveInner(t.from, 1); node; node = node.parent) {
          if (/Code|HTML|Comment/.test(node.name)) return false;
        }
        return true;
      });
      const items = livePreview({
        text: this.text,
        tree: syntaxTree(state),
        links: this.links,
        tags: this.tags,
        isActive: activeTest(view),
        ranges: view.visibleRanges,
      });
      const ranges = [];
      for (const item of items) {
        switch (item.type) {
          case 'line':
            ranges.push(Decoration.line({ class: item.cls }).range(item.from));
            break;
          case 'mark':
            ranges.push(Decoration.mark({ class: item.cls, attributes: item.tag ? { 'data-tag': item.tag } : undefined }).range(item.from, item.to));
            break;
          case 'hide':
            ranges.push(hidden.range(item.from, item.to));
            break;
          case 'wikilink': {
            const href = item.target + (item.subpath ? `#${item.subpath}` : '');
            const widget = new WikilinkWidget(item.label, href, Boolean(!item.target || resolve(item.target)), open);
            ranges.push(Decoration.replace({ widget }).range(item.from, item.to));
            break;
          }
          case 'embed':
            ranges.push(Decoration.replace({ widget: new EmbedWidget(item.target, item.subpath, item.alias, resolve(item.target), embedNote, version()) }).range(item.from, item.to));
            break;
          case 'bullet':
            ranges.push(bullet.range(item.from, item.to));
            break;
          case 'task':
            ranges.push(Decoration.replace({ widget: new TaskWidget(item.checked, item.marker) }).range(item.from, item.to));
            break;
          case 'hr':
            ranges.push(rule.range(item.from, item.to));
            break;
          case 'math':
            ranges.push(Decoration.replace({ widget: new MathWidget(item.tex) }).range(item.from, item.to));
            break;
          default:
        }
      }
      return Decoration.set(ranges, true);
    }
  }, { decorations: (plugin) => plugin.decorations });
}

// Replaces CodeMirror's default highlighting (which underlines headings): syntax characters are
// faint, code in fences gets a few colors.
export const markdownHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--text-faint)' },
  { tag: [tags.link, tags.url], color: 'var(--text-accent)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--text-muted)' },
  { tag: [tags.keyword, tags.operatorKeyword], color: '#c792ea' },
  { tag: [tags.string, tags.special(tags.string)], color: '#c3e88d' },
  { tag: [tags.number, tags.bool, tags.null], color: '#f78c6c' },
  { tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#82aaff' },
]));
