const STORAGE_KEY = 'docs.prefs';

// Per-device preferences of the interface (editor, appearance, daily notes…). The vault path and
// the sync settings live in the main process config instead.
export const DEFAULT_PREFS = {
  // editor
  defaultMode: 'source',
  livePreview: true,
  fontSize: 16,
  readableLineLength: true,
  lineNumbers: false,
  foldGutter: true,
  vimMode: false,
  spellcheck: true,
  autoPair: true,
  // files & links
  attachmentFolder: 'anexos',
  newNoteFolder: '',
  autoUpdateLinks: true,
  // daily notes & templates
  dailyFolder: 'Diário',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  dailyOnStart: false,
  templatesFolder: 'Modelos',
  templateDateFormat: 'YYYY-MM-DD',
  templateTimeFormat: 'HH:mm',
  // appearance
  theme: 'dark',
  accentColor: '#7f6df2',
  uiFontSize: 14,
  textFont: '',
  monoFont: '',
  // Claude ('' = Claude Code's default model)
  claudeModel: '',
};

// Settings tabs built from this list; `type` picks the control.
export const PREF_SECTIONS = [
  {
    id: 'editor',
    title: 'Editor',
    items: [
      { key: 'defaultMode', label: 'Modo padrão das notas', type: 'select', options: [['source', 'Edição'], ['reading', 'Leitura']] },
      { key: 'livePreview', label: 'Live Preview', desc: 'Mostra o Markdown formatado enquanto edita.', type: 'toggle' },
      { key: 'fontSize', label: 'Tamanho da fonte do texto', type: 'number', min: 10, max: 30 },
      { key: 'readableLineLength', label: 'Largura de linha legível', desc: 'Limita a largura do texto.', type: 'toggle' },
      { key: 'lineNumbers', label: 'Números de linha', type: 'toggle' },
      { key: 'foldGutter', label: 'Dobrar títulos e listas', desc: 'Setas na margem para recolher seções.', type: 'toggle' },
      { key: 'autoPair', label: 'Fechar colchetes e aspas', type: 'toggle' },
      { key: 'spellcheck', label: 'Corretor ortográfico', type: 'toggle' },
      { key: 'vimMode', label: 'Modo Vim', desc: 'Atalhos de teclado do Vim no editor.', type: 'toggle' },
    ],
  },
  {
    id: 'files',
    title: 'Arquivos e links',
    items: [
      { key: 'newNoteFolder', label: 'Pasta das notas novas', desc: 'Vazio = raiz do vault.', type: 'text' },
      { key: 'attachmentFolder', label: 'Pasta dos anexos', desc: 'Onde ficam imagens coladas ou arrastadas para o editor.', type: 'text' },
      { key: 'autoUpdateLinks', label: 'Atualizar links ao renomear', desc: 'Corrige os [[links]] das outras notas quando uma nota muda de nome ou de pasta.', type: 'toggle' },
    ],
  },
  {
    id: 'daily',
    title: 'Notas diárias',
    items: [
      { key: 'dailyFolder', label: 'Pasta', type: 'text' },
      { key: 'dailyFormat', label: 'Formato do nome', desc: 'YYYY ano, MM mês, DD dia, ddd dia da semana.', type: 'text' },
      { key: 'dailyTemplate', label: 'Modelo', desc: 'Caminho de uma nota usada como modelo (opcional).', type: 'text' },
      { key: 'dailyOnStart', label: 'Abrir a nota de hoje ao iniciar', type: 'toggle' },
    ],
  },
  {
    id: 'templates',
    title: 'Modelos',
    items: [
      { key: 'templatesFolder', label: 'Pasta dos modelos', type: 'text' },
      { key: 'templateDateFormat', label: 'Formato de {{date}}', type: 'text' },
      { key: 'templateTimeFormat', label: 'Formato de {{time}}', type: 'text' },
    ],
  },
  {
    id: 'appearance',
    title: 'Aparência',
    items: [
      { key: 'theme', label: 'Tema', type: 'select', options: [['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Igual ao sistema']] },
      { key: 'accentColor', label: 'Cor de destaque', type: 'color' },
      { key: 'uiFontSize', label: 'Tamanho da fonte da interface', type: 'number', min: 11, max: 20 },
      { key: 'textFont', label: 'Fonte do texto', desc: 'Nome de uma fonte instalada (vazio = padrão).', type: 'text' },
      { key: 'monoFont', label: 'Fonte monoespaçada', type: 'text' },
    ],
  },
];

class Prefs extends EventTarget {
  constructor() {
    super();
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
      saved = {};
    }
    this.values = { ...DEFAULT_PREFS };
    for (const [key, value] of Object.entries(saved)) {
      if (Object.hasOwn(DEFAULT_PREFS, key) && typeof value === typeof DEFAULT_PREFS[key]) this.values[key] = value;
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (!Object.hasOwn(DEFAULT_PREFS, key) || this.values[key] === value) return;
    this.values[key] = value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // storage unavailable: the change lasts until the app closes
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  }
}

export const prefs = new Prefs();
