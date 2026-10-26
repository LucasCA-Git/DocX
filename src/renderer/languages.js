import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/legacy-modes/mode/python';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { c, cpp, java, csharp, kotlin, dart } from '@codemirror/legacy-modes/mode/clike';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { xml } from '@codemirror/legacy-modes/mode/xml';
import { r } from '@codemirror/legacy-modes/mode/r';
import { perl } from '@codemirror/legacy-modes/mode/perl';

// Languages for ```fenced code: highlighted in the editor (CodeMirror) and in the reading view
// (same parsers, through @lezer/highlight's classHighlighter → .tok-* classes).
const stream = (parser) => new LanguageSupport(StreamLanguage.define(parser));
const LANGS = [
  ['JavaScript', ['js', 'javascript', 'jsx', 'node', 'mjs', 'cjs'], () => javascript({ jsx: true })],
  ['TypeScript', ['ts', 'typescript', 'tsx'], () => javascript({ jsx: true, typescript: true })],
  ['JSON', ['json', 'jsonc'], () => javascript()],
  ['CSS', ['css', 'scss', 'less'], () => css()],
  ['HTML', ['html', 'htm', 'vue', 'svelte'], () => html()],
  ['Python', ['py', 'python'], () => stream(python)],
  ['Shell', ['sh', 'bash', 'shell', 'zsh', 'fish', 'console'], () => stream(shell)],
  ['YAML', ['yaml', 'yml'], () => stream(yaml)],
  ['SQL', ['sql', 'psql', 'mysql'], () => stream(standardSQL)],
  ['Go', ['go', 'golang'], () => stream(go)],
  ['Rust', ['rs', 'rust'], () => stream(rust)],
  ['C', ['c', 'h'], () => stream(c)],
  ['C++', ['cpp', 'c++', 'cc', 'hpp'], () => stream(cpp)],
  ['Java', ['java'], () => stream(java)],
  ['C#', ['cs', 'csharp', 'c#'], () => stream(csharp)],
  ['Kotlin', ['kt', 'kotlin'], () => stream(kotlin)],
  ['Dart', ['dart'], () => stream(dart)],
  ['Ruby', ['rb', 'ruby'], () => stream(ruby)],
  ['PowerShell', ['ps1', 'powershell', 'pwsh'], () => stream(powerShell)],
  ['TOML', ['toml'], () => stream(toml)],
  ['Dockerfile', ['dockerfile', 'docker'], () => stream(dockerFile)],
  ['Properties', ['ini', 'properties', 'conf', 'env'], () => stream(properties)],
  ['Lua', ['lua'], () => stream(lua)],
  ['Swift', ['swift'], () => stream(swift)],
  ['Diff', ['diff', 'patch'], () => stream(diff)],
  ['XML', ['xml', 'svg', 'xaml', 'csproj'], () => stream(xml)],
  ['R', ['r'], () => stream(r)],
  ['Perl', ['pl', 'perl'], () => stream(perl)],
];

const supports = new Map();
function supportFor(name, make) {
  if (!supports.has(name)) supports.set(name, make());
  return supports.get(name);
}

export const codeLanguages = LANGS.map(([name, alias, make]) => LanguageDescription.of({
  name,
  alias,
  load: async () => supportFor(name, make),
}));

const byAlias = new Map();
for (const [name, alias, make] of LANGS) for (const a of alias) byAlias.set(a, () => supportFor(name, make));

// Highlighted code as DOM nodes, or null for an unknown language.
export function highlightToNodes(code, lang) {
  const support = byAlias.get(String(lang).toLowerCase())?.();
  if (!support) return null;
  const nodes = [];
  const tree = support.language.parser.parse(code);
  highlightCode(code, tree, classHighlighter, (text, classes) => {
    if (!classes) nodes.push(document.createTextNode(text));
    else {
      const span = document.createElement('span');
      span.className = classes;
      span.textContent = text;
      nodes.push(span);
    }
  }, () => nodes.push(document.createTextNode('\n')));
  return nodes;
}
