# Stack

- **Shell:** Electron 33, main em CommonJS, renderer empacotado com esbuild (`scripts/build.js`) em IIFE.
- **Editor:** CodeMirror 6 (`codemirror`, `@codemirror/lang-markdown`); sugestões de `[[` via `@codemirror/autocomplete` (já incluso no `basicSetup`).
- **Preview:** `marked` + `DOMPurify`; wikilinks e embeds substituídos antes do parse.
- **Índice de links:** função pura que extrai links e embeds de cada nota (testável no Node com `node --test`); grafo = notas + anexos + arestas derivadas desse índice.
- **Graph View:** simulação de forças (`d3-force`) num Web Worker, como o "Graph Worker" (`sim.js`) do Obsidian; desenho em Canvas 2D. PixiJS só se o Canvas não sustentar ~2000 nós.
- **Imagens:** protocolo próprio registrado no main (`protocol.handle`) que só serve arquivos de imagem de dentro do vault; CSP `img-src` libera esse esquema.
- **Sync:** `@aws-sdk/client-s3` com `followRegionRedirects`, credenciais do perfil AWS CLI via `fromIni`.
- **Testes:** `node --test` para lógica pura (índice de links, resolução de wikilinks, sync); revisão com agentes ECC.
