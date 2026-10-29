'use strict';

// Changes Claude proposes in its answers. Claude only reads the vault; to write it puts blocks like
//   <docx-action type="create" path="Pasta/Nota.md">
//   …full content…
//   </docx-action>
// in the text, and DocX applies each one after the user approves it. Types: create (a new file),
// edit (the whole new content of an existing file), mkdir (a folder, no content).

const TYPES = new Set(['create', 'edit', 'mkdir']);
// Files Claude may write: notes, canvases, drawings and diagrams.
const WRITABLE_RE = /\.(md|txt|canvas|excalidraw|drawio)$/i;
const BLOCK_RE = /<docx-action\b([^>]*)>([\s\S]*?)<\/docx-action>/g;
const OPEN_RE = /<docx-action\b/;
const ATTR_RE = /([a-z]+)\s*=\s*"([^"]*)"/g;

// A vault path from Claude: relative, "/"-separated, no "..", no hidden or empty segments.
function cleanPath(raw) {
  if (typeof raw !== 'string') return null;
  const rel = raw.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!rel || rel.startsWith('/') || /^[a-z]:/i.test(rel) || /[\0-\x1f<>:"|?*]/.test(rel)) return null;
  const parts = rel.split('/');
  if (parts.some((p) => !p.trim() || p.startsWith('.') || p !== p.trim())) return null;
  return parts.join('/');
}

// Content of a block without the line breaks that wrap it.
const blockBody = (body) => body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

function parseAttrs(text) {
  const attrs = {};
  for (const [, key, value] of text.matchAll(ATTR_RE)) attrs[key] = value;
  return attrs;
}

// -> { action, error }: error explains why a block cannot be applied.
function toAction(attrs, body) {
  const type = attrs.type;
  const path = cleanPath(attrs.path);
  if (!TYPES.has(type)) return { error: `tipo de ação desconhecido: "${type ?? ''}"` };
  if (!path) return { error: `caminho inválido: "${attrs.path ?? ''}"` };
  if (type === 'mkdir') return { action: { type, path } };
  if (!WRITABLE_RE.test(path)) return { error: `tipo de arquivo não permitido: "${path}"` };
  return { action: { type, path, content: blockBody(body) } };
}

// Splits Claude's answer into text and action pieces, in order:
// [{ kind: 'text', text } | { kind: 'action', action } | { kind: 'invalid', error } | { kind: 'pending' }].
// 'pending' is a block still being written while the answer streams; in a finished answer
// (final) an unclosed "<docx-action" is just text.
function splitAnswer(text, { final = false } = {}) {
  const pieces = [];
  let last = 0;
  const pushText = (chunk) => {
    if (chunk.trim()) pieces.push({ kind: 'text', text: chunk });
  };
  for (const match of text.matchAll(BLOCK_RE)) {
    pushText(text.slice(last, match.index));
    const { action, error } = toAction(parseAttrs(match[1]), match[2]);
    pieces.push(action ? { kind: 'action', action } : { kind: 'invalid', error });
    last = match.index + match[0].length;
  }
  const rest = text.slice(last);
  const open = final ? -1 : rest.search(OPEN_RE);
  if (open === -1) {
    pushText(rest);
  } else {
    pushText(rest.slice(0, open));
    pieces.push({ kind: 'pending' });
  }
  return pieces;
}

const parseActions = (text) => splitAnswer(text).filter((p) => p.kind === 'action').map((p) => p.action);

module.exports = { splitAnswer, parseActions, cleanPath };
