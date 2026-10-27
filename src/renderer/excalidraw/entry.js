// Drawing editor: the official Excalidraw component (MIT), bundled on its own into
// vendor/excalidraw/excalidraw.js and loaded the first time a drawing is opened or embedded.
// It exposes a small API on window.DocxExcalidraw; the rest of the app never imports React.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { parseScene } from '../../shared/excalidraw-scene';

// Mounts an editor in `container`. onChange(json) receives the serialized scene after each edit.
function mount(container, { text, theme, onChange, onLinkOpen, libraryItems, onLibraryChange }) {
  const scene = parseScene(text);
  const root = createRoot(container);
  let api = null;
  let currentTheme = theme;
  let last = null;

  const serialize = () => serializeAsJSON(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles(), 'local');

  const render = () => root.render(createElement(Excalidraw, {
    initialData: { ...scene, libraryItems, scrollToContent: true },
    excalidrawAPI: (value) => {
      api = value;
    },
    theme: currentTheme,
    langCode: 'pt-BR',
    // Pointer moves, scrolls and selections also call onChange: only real content changes count.
    onChange: () => {
      if (!api) return;
      const json = serialize();
      if (last === null) {
        last = json;
        return;
      }
      if (json !== last) {
        last = json;
        onChange(json);
      }
    },
    onLinkOpen: (element, event) => {
      event.preventDefault();
      onLinkOpen?.(element.link);
    },
    onLibraryChange,
    // Embedded web pages (YouTube, Figma…) would load remote content inside the app window.
    validateEmbeddable: () => false,
    UIOptions: {
      canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, export: { saveFileToDisk: true } },
      tools: { image: true },
    },
  }, createElement(MainMenu, null,
    createElement(MainMenu.DefaultItems.SaveAsImage),
    createElement(MainMenu.DefaultItems.Export),
    createElement(MainMenu.DefaultItems.SearchMenu),
    createElement(MainMenu.DefaultItems.Help),
    createElement(MainMenu.DefaultItems.ClearCanvas),
    createElement(MainMenu.Separator),
    createElement(MainMenu.DefaultItems.ChangeCanvasBackground))));

  render();
  return {
    serialize: () => (api ? serialize() : null),
    setTheme(next) {
      if (next === currentTheme) return;
      currentTheme = next;
      render();
    },
    // The file changed on disk (sync): replace the scene without adding to undo history.
    load(nextText) {
      if (!api) return;
      const next = parseScene(nextText);
      api.addFiles(Object.values(next.files));
      api.updateScene({ elements: next.elements, captureUpdate: 'NEVER' });
      last = serialize();
    },
    unmount() {
      root.unmount();
    },
  };
}

// The drawing as SVG markup, for ![[desenho.excalidraw]] in notes.
async function renderSvg(text, { dark }) {
  const { elements, appState, files } = parseScene(text);
  const svg = await exportToSvg({
    elements: elements.filter((el) => !el.isDeleted),
    appState: { ...appState, exportBackground: true, exportWithDarkMode: dark },
    files,
    exportPadding: 10,
  });
  return svg.outerHTML;
}

window.DocxExcalidraw = { mount, renderSvg, parseScene };
