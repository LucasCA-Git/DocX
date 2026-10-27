'use strict';

// The diagram editor's origin and URL, shared by the main process (which serves it) and the
// renderer (which frames it and checks the origin of its messages).
const DRAWIO_SCHEME = 'docx-drawio';
const DRAWIO_HOST = 'app';
const DRAWIO_ORIGIN = `${DRAWIO_SCHEME}://${DRAWIO_HOST}`;

// Editor URL: embed protocol (JSON messages), no network features, Portuguese, app theme.
function drawioEditorUrl({ dark }) {
  const params = new URLSearchParams({
    embed: '1', proto: 'json', spin: '1', offline: '1', stealth: '1', pwa: '0', math: '0',
    lang: 'pt-br', ui: dark ? 'dark' : 'kennedy', dark: dark ? '1' : '0',
    libraries: '1', noExitBtn: '1', noSaveBtn: '1', saveAndExit: '0', configure: '0', modified: 'unsavedChanges',
  });
  return `${DRAWIO_ORIGIN}/index.html?${params}`;
}

module.exports = { DRAWIO_SCHEME, DRAWIO_HOST, DRAWIO_ORIGIN, drawioEditorUrl };
