import {
  createElement,
  ArrowLeft, ArrowRight, ArrowUpRight, CircleHelp, FileDown, Group, LayoutDashboard, Link2, Maximize, Palette, Redo2, SquarePlus, StickyNote, Undo2, Pin, Rows2, Bookmark, Calendar, Bug, CircleCheck, Clipboard, Flame, Info, Quote, Zap, ArrowUpDown, Columns2, Copy, Folder, FolderInput, FolderOpen, ChevronDown, List, Tag, BookOpen, Check, ChevronRight, ChevronsDownUp, Cloud, CloudOff, EllipsisVertical,
  FilePlus, FileText, Files, FolderPlus, GitFork, History, Image, Link, PanelLeft, PanelRight, Pencil, Plus, RefreshCw, Search,
  Settings, SquareTerminal, Trash2, TriangleAlert, X, ArrowRightLeft, PenTool, Workflow, Sparkles, SendHorizontal, CircleStop,
} from 'lucide';

const ICONS = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up-right': ArrowUpRight,
  'chevron-down': ChevronDown,
  'file-down': FileDown,
  group: Group,
  canvas: LayoutDashboard,
  'pen-tool': PenTool,
  workflow: Workflow,
  'link-2': Link2,
  maximize: Maximize,
  palette: Palette,
  redo: Redo2,
  'square-plus': SquarePlus,
  'sticky-note': StickyNote,
  undo: Undo2,
  pin: Pin,
  rows: Rows2,
  bookmark: Bookmark,
  calendar: Calendar,
  bug: Bug,
  'circle-check': CircleCheck,
  clipboard: Clipboard,
  flame: Flame,
  info: Info,
  quote: Quote,
  zap: Zap,
  'arrow-up-down': ArrowUpDown,
  columns: Columns2,
  copy: Copy,
  folder: Folder,
  'folder-input': FolderInput,
  'folder-open': FolderOpen,
  help: CircleHelp,
  list: List,
  tag: Tag,
  'book-open': BookOpen,
  check: Check,
  'chevron-right': ChevronRight,
  'chevrons-down-up': ChevronsDownUp,
  cloud: Cloud,
  'cloud-off': CloudOff,
  more: EllipsisVertical,
  'file-plus': FilePlus,
  'file-text': FileText,
  files: Files,
  'folder-plus': FolderPlus,
  graph: GitFork,
  history: History,
  image: Image,
  link: Link,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  pencil: Pencil,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  send: SendHorizontal,
  settings: Settings,
  sparkles: Sparkles,
  stop: CircleStop,
  switcher: ArrowRightLeft,
  terminal: SquareTerminal,
  trash: Trash2,
  warning: TriangleAlert,
  x: X,
};

export function icon(name, size = 18) {
  const svg = createElement(ICONS[name]);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('icon');
  return svg;
}

// el('button', { class: 'x', title: 'y', onclick: fn }, child, 'text', …)
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function iconButton(name, title, onclick, className = 'clickable-icon') {
  return el('button', { class: className, title, 'aria-label': title, onclick }, icon(name));
}

export const $ = (selector) => document.querySelector(selector);

export const TEXT_FILE = /\.(md|markdown|txt)$/i;
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
export const baseName = (rel) => rel.split('/').pop();
export const dirName = (rel) => rel.split('/').slice(0, -1).join('/');
export const displayName = (rel) => baseName(rel).replace(/\.md$/i, '');
export const extension = (rel) => (baseName(rel).match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);

// "Sem título.md", "Sem título 1.md", … whichever is free in `taken`.
export function uniquePath(dir, stem, ext, taken) {
  const lower = new Set([...taken].map((p) => p.toLowerCase()));
  for (let i = 0; ; i++) {
    const rel = joinPath(dir, `${stem}${i ? ` ${i}` : ''}${ext}`);
    if (!lower.has(rel.toLowerCase())) return rel;
  }
}

export function errorText(err) {
  return String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
