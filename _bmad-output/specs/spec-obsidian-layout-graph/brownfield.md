# Brownfield — estado em 2026-10-23

- `src/main/main.js`: janela segura, IPC `vault:*`, `config:*` e `sync:*` com checagem de origem; watcher com debounce de 600 ms; sync completo a cada 30 s.
- `src/main/vault.js`: caminhos relativos POSIX, bloqueio de path traversal, escrita atômica, exclusão para `.trash`; dotfiles e `node_modules` são ignorados (inclui `.obsidian`).
- `src/main/sync/`: motor de sync em três vias (base = último estado sincronizado), escrita condicional no S3, cópia "conflito"; 12 testes passando.
- `src/renderer/app.js`: barra lateral com árvore (`<details>` sempre aberto), um único editor, alternância edição/preview, wikilinks só no preview, sem embeds, sem abas, sem grafo.
- `vault:read` devolve UTF-8: não serve para imagens. O preview precisa de outra via (ver `stack.md`, protocolo de imagens).
- O sync já envia e baixa qualquer arquivo, incluindo imagens. CAP-5 está implementado e falta só a verificação ponta a ponta com o bucket real.
