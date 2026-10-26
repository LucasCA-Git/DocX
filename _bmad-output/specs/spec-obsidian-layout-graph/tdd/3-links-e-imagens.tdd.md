# TDD — História 3: links no editor e imagens embutidas

**Fonte:** `stories.yaml` id "3" (CAP-2, CAP-3). Sem checkpoints git: o usuário não pediu commits.

## Evidência
- **Módulos puros (TDD):** `shared/asset-url.js`, `main/asset-protocol.js`, `shared/link-suggest.js`, `linkAt` em `shared/links.js` — RED `# fail 3` (`Cannot find module`), GREEN; suíte 59/59.
- **Electron real (smoke, vault temporário em %TEMP%\docs-smoke):** protocolo serve `Pasta/Terminus SFTP.png` (2x3) e dá 404 para `..%2F`, `../`, `%2E%2E`, `.md`; preview mostra a imagem com `|120`, aviso para `![[Faltando.png]]`; `[[Dep` sugere as 2 notas de Deploy e Enter grava `[[Deploy Front_End]]`; Ctrl+clique em `[[Inexistente]]` cria e abre a nota; links dentro de bloco de código não são marcados.
- **Bug achado no smoke:** autocomplete nunca aparecia — `languageData` criava uma função nova por consulta e o CodeMirror identifica fontes por referência. Fonte criada uma vez por view.

## Revisão ecc:security-reviewer (0 CRITICAL, 0 HIGH, 1 MEDIUM, 4 LOW)
- MEDIUM nome curto 8.3 (`TRASH~1`) passava pelo filtro de pastas ocultas → `isIgnored` também no caminho real (teste com junction). Corrigido.
- LOW `:` (alternate data streams) e `<>"|?*` em segmentos → rejeitados em `assetPathFromUrl`. Corrigido.
- LOW cabeçalhos → `Content-Type` pela extensão, `nosniff`, CSP `default-src 'none'; sandbox` (teste `assetHeaders`). Corrigido.
- LOW TOCTOU entre realpath e leitura → não corrigido (exige escrita local no vault; o sync só grava arquivos comuns).
- Info: CSP `img-src https:` permite imagens remotas em notas (pré-existente).

## Revisão ecc:code-reviewer (0 CRITICAL, 0 HIGH, 4 MEDIUM, 5 LOW)
- MEDIUM Ctrl+Shift+clique abria segunda aba da mesma nota → `openFile` sempre troca para a aba existente.
- MEDIUM `[[Notes v1.2]]` criava arquivo sem extensão; `![[foto.png]]` criava imagem vazia → `newNotePath` (TDD): `.md` exceto md/markdown/txt; anexos não são criados (aviso).
- MEDIUM Ctrl+clique na margem pegava o link → exige clique em `.cm-wikilink`, `posAtCoords(..., false)`, parse só da linha.
- MEDIUM marcação de link dentro de código → decorações consultam a árvore de sintaxe; recriadas quando a árvore muda.
- MEDIUM completar no meio de `[[fo|obar]]` deixava sobra → `wikilinkTail` (TDD) estende o `to` até `]]`.
- LOW corrigidos: sem sugestões dentro de código; criação duplicada por duplo clique; `Intl.Collator` em cache; raiz de drive (`path.relative`); arquivos com `#|[]` fora das sugestões; testes de borda de `linkAt`, `.markdown`, mesmo nome em pastas diferentes.
- Suíte final: 67/67.
