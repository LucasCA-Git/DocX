# TDD — Histórias 6 (backlinks + grafo local) e 7 (busca no vault)

**Fonte:** `stories.yaml` ids "6" (CAP-7, CAP-8) e "7" (CAP-9).

## Desenho
- `shared/backlinks-search.js` (puro): `backlinksFor` (notas que apontam + linhas), `foldText` (minúsculas sem acento, mesmo tamanho), `searchVault` (por nome e texto, primeira ocorrência por linha, cache do texto normalizado).
- `shared/graph-model.js`: `graphData({ center, depth })` para o grafo local.
- Barra lateral direita (`right-sidebar.js`, Ctrl+Shift+B ou botão no fim da barra de abas): abas Backlinks e Grafo local (GraphView em modo local, centrado na última nota ativa; worker só existe com a aba visível).
- Busca na barra esquerda (`search-pane.js`, Ctrl+Shift+F): resultados por nota com trecho destacado; clique abre a nota com o trecho selecionado.
- Posições por linha/coluna (não offset): o CodeMirror converte CRLF em LF.

## Evidência
- RED `Cannot find module '../src/shared/backlinks-search'` + teste de grafo local → GREEN; suíte final 99/99.
- Electron real (vault de 407 notas): backlinks de "Deploy Front_manual" = "Deploy Front_End" com a linha; grafo local 5 nós/4 links (anexos amarelos, nota central roxa); busca "NOTA 12" → 11 notas; clique abre n12 na linha; nota CRLF com "ALVO" na linha 31 → cursor na linha certa e "ALVO" selecionado.
- Bugs achados no smoke: atributo `hidden` perdia para `display:flex` (lista de arquivos aparecia junto da busca) → regra global `[hidden]`; grafo local em zoom 2 com rótulos enormes → zoom máximo 1 e fonte 10 px; Live Preview calculava linha ativa antes do foco → foco antes da seleção.
- Desempenho da busca (2000 notas): com cache 20–120 ms por busca; primeira passada em 40 MB com acentos 0,6 s (era 2,5 s; `replace` só nos não-ASCII).

## Revisão ecc:code-reviewer (0 CRITICAL, 1 HIGH, 3 MEDIUM, 3 LOW)
- HIGH campo `this.local` sombreava o método `local(event)` → mouse morto nos dois grafos (regressão). Campo renomeado `isLocal`; smoke do grafo global repetido (hover, clique, atualização OK).
- MEDIUM offsets errados em notas CRLF → linha/coluna (teste CRLF).
- MEDIUM busca lenta por tecla → cache por nota + caminho rápido de dobra (teste de cache; invariante de tamanho verificado nos 65 536 code units).
- MEDIUM status bar cobria o painel direito → espaço no fim dos painéis.
- LOW nota apagada continuava seguida pelos painéis → `followedNotePath` só devolve nota existente.
- LOW não corrigidos: Hangul decompõe em jamo (falso positivo em coreano); 148 px reservados para os botões da janela ficam ociosos com o painel direito aberto.
