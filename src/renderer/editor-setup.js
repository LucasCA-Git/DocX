import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap, foldAll, unfoldAll } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap, openSearchPanel } from '@codemirror/search';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { vim } from '@replit/codemirror-vim';
import { prefs } from './prefs';
import { wrap, linePrefix, cycleTask, insertLink } from '../shared/formatting';

// CodeMirror's own texts (search panel, folding) in Portuguese.
const phrases = EditorState.phrases.of({
  Find: 'Buscar',
  Replace: 'Substituir',
  next: 'próximo',
  previous: 'anterior',
  all: 'todos',
  'match case': 'maiúsculas',
  regexp: 'regex',
  'by word': 'palavra inteira',
  replace: 'substituir',
  'replace all': 'substituir todos',
  close: 'fechar',
  'current match': 'ocorrência atual',
  'replaced $ matches': '$ ocorrências substituídas',
  'replaced match on line $': 'ocorrência substituída na linha $',
  'on line': 'na linha',
  'Go to line': 'Ir para a linha',
  go: 'ir',
  'Folded lines': 'Linhas recolhidas',
  'Unfolded lines': 'Linhas expandidas',
  to: 'até',
  'folded code': 'trecho recolhido',
  unfold: 'expandir',
  'Fold line': 'Recolher',
  'Unfold line': 'Expandir',
  'Control character': 'Caractere de controle',
  Completions: 'Sugestões',
});

// Parts that follow the preferences, swapped at run time through compartments.
const compartments = {
  vim: new Compartment(),
  lineNumbers: new Compartment(),
  fold: new Compartment(),
  closeBrackets: new Compartment(),
  spellcheck: new Compartment(),
};

const configured = {
  vim: () => (prefs.get('vimMode') ? vim() : []),
  lineNumbers: () => (prefs.get('lineNumbers') ? [lineNumbers(), highlightActiveLineGutter()] : []),
  fold: () => (prefs.get('foldGutter') ? foldGutter({ openText: '▾', closedText: '▸' }) : []),
  closeBrackets: () => (prefs.get('autoPair') ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
  spellcheck: () => EditorView.contentAttributes.of({ spellcheck: prefs.get('spellcheck') ? 'true' : 'false', lang: 'pt-BR', autocorrect: 'off' }),
};

const PREF_COMPARTMENT = { vimMode: 'vim', lineNumbers: 'lineNumbers', foldGutter: 'fold', autoPair: 'closeBrackets', spellcheck: 'spellcheck' };

// The editor setup (basicSetup, unrolled so parts can follow the preferences).
export function editorExtensions() {
  return [
    // Vim must come first so its keys win.
    compartments.vim.of(configured.vim()),
    phrases,
    compartments.lineNumbers.of(configured.lineNumbers()),
    compartments.fold.of(configured.fold()),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    compartments.closeBrackets.of(configured.closeBrackets()),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    compartments.spellcheck.of(configured.spellcheck()),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
  ];
}

// Called by a note view when a preference changed.
export function applyPref(view, key) {
  const name = PREF_COMPARTMENT[key];
  if (name) view.dispatch({ effects: compartments[name].reconfigure(configured[name]()) });
}

// ---------- editor commands (palette + hotkeys) ----------

function run(view, fn) {
  const { from, to } = view.state.selection.main;
  const { changes, selection } = fn(view.state.doc.toString(), from, to);
  view.dispatch({ changes, selection, scrollIntoView: true, userEvent: 'input' });
  view.focus();
}

export const EDITOR_COMMANDS = [
  ['bold', 'Negrito', ['Mod+B'], (v) => run(v, (d, f, t) => wrap(d, f, t, '**'))],
  ['italic', 'Itálico', ['Mod+I'], (v) => run(v, (d, f, t) => wrap(d, f, t, '*'))],
  ['strikethrough', 'Riscado', [], (v) => run(v, (d, f, t) => wrap(d, f, t, '~~'))],
  ['highlight', 'Destacar (==marca==)', [], (v) => run(v, (d, f, t) => wrap(d, f, t, '=='))],
  ['code', 'Código em linha', [], (v) => run(v, (d, f, t) => wrap(d, f, t, '`'))],
  ['comment', 'Comentário (%%)', ['Mod+/'], (v) => run(v, (d, f, t) => wrap(d, f, t, '%%'))],
  ['math', 'Matemática em linha ($)', [], (v) => run(v, (d, f, t) => wrap(d, f, t, '$'))],
  ['link', 'Inserir link Markdown', ['Mod+K'], (v) => run(v, insertLink)],
  ['wikilink', 'Inserir link interno [[ ]]', [], (v) => run(v, (d, f, t) => wrap(d, f, t, '[[', ']]'))],
  ['task', 'Alternar caixa de seleção', ['Mod+L'], (v) => run(v, cycleTask)],
  ['bullet', 'Lista com marcadores', [], (v) => run(v, (d, f, t) => linePrefix(d, f, t, 'bullet'))],
  ['number', 'Lista numerada', [], (v) => run(v, (d, f, t) => linePrefix(d, f, t, 'number'))],
  ['quote', 'Citação', [], (v) => run(v, (d, f, t) => linePrefix(d, f, t, 'quote'))],
  ...[1, 2, 3, 4, 5, 6].map((n) => [`heading-${n}`, `Título ${n}`, [], (v) => run(v, (d, f, t) => linePrefix(d, f, t, `h${n}`))]),
  ['code-block', 'Inserir bloco de código', [], (v) => insertBlock(v, '```\n', '\n```')],
  ['math-block', 'Inserir bloco de matemática', [], (v) => insertBlock(v, '$$\n', '\n$$')],
  ['table', 'Inserir tabela', [], (v) => insertBlock(v, '| Coluna 1 | Coluna 2 |\n| --- | --- |\n| ', ' |  |')],
  ['callout', 'Inserir callout', [], (v) => insertBlock(v, '> [!note] Título\n> ', '')],
  ['hr', 'Inserir linha horizontal', [], (v) => insertBlock(v, '\n---\n', '')],
  ['find', 'Buscar e substituir na nota', ['Mod+H'], (v) => openSearchPanel(v)],
  ['fold-all', 'Recolher tudo', [], (v) => foldAll(v)],
  ['unfold-all', 'Expandir tudo', [], (v) => unfoldAll(v)],
  ['date', 'Inserir data de hoje', [], (v) => insertText(v, new Date().toLocaleDateString('sv-SE'))],
  ['time', 'Inserir hora', [], (v) => insertText(v, new Date().toTimeString().slice(0, 5))],
];

export function insertText(view, text) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
}

// A block on its own lines around the selection, cursor inside.
function insertBlock(view, before, after) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const sel = view.state.sliceDoc(from, to);
  const pre = from > line.from ? '\n' : '';
  const insert = `${pre}${before}${sel}${after}`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + pre.length + before.length + sel.length }, scrollIntoView: true });
  view.focus();
}
