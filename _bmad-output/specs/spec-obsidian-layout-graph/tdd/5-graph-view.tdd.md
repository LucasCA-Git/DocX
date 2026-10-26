# TDD — História 5: Graph View global

**Fonte:** `stories.yaml` id "5" (CAP-4). done_checkpoint: aguardando teste do usuário.

## Desenho
- Índice completo: `vault:read-texts` (main, em lotes de 64, só notas ≤ 5 MB, ≤ 20 000 caminhos) → `VaultStore.refresh(changed)` indexa todas as notas ao abrir e relê as alteradas; `updateNote` a cada save (evento `links`).
- `shared/graph-model.js` (puro): filtros (anexos, links sem nota, órfãs, busca), tamanho do nó, câmera (zoom no cursor), hit test, posição de nós novos perto dos vizinhos.
- `renderer/graph-worker.js`: d3-force num Web Worker (como o sim.js do Obsidian); posições em Float32Array transferível; `gen` descarta ticks antigos.
- `views/graph-view.js`: Canvas 2D, nós como sprites, links em hairline, rótulos que surgem com o zoom, hover destaca vizinhos, clique abre (Ctrl = nova aba), arrastar nó, pan, zoom, painel de filtros; câmera acompanha o layout até o usuário interagir.

## Evidência
- RED `Cannot find module '../src/shared/graph-model'` / `readTexts is not a function` → GREEN; suíte final 91/91.
- Electron real, vault de 406 notas + anexos: anexos amarelos, rótulos no zoom, clique abre "Deploy Front_manual", filtro "Front_manual" → 1 nó, editar a nota adicionando `[[Sozinha]]` → links 534→535 em < 2 s (inclui 800 ms do autosave).
- Desempenho, vault de 2000 notas / 3950 links: carga ~0,7–1 s; frame 6 ms (mediana e p95) durante a simulação.
  - Investigação: frames de 270 ms no início (2000 rótulos em zoom 1) → câmera acompanha o layout + culling fora da tela. Depois 42–55 ms: micro-benchmark mostrou que o traço das linhas com 1/k px custava 58 ms; hairline (1 px de tela) 4,7 ms.

## Revisão ecc:code-reviewer (0 CRITICAL, 2 HIGH, 5 MEDIUM, 4 LOW)
- HIGH arraste guardava índice do nó; grafo reconstruído no meio do arraste quebrava/abria nota errada → guarda o id.
- HIGH `refresh(changed)` perdia caminhos quando outro refresh o superava → `pendingChanged` acumulado até ser aplicado.
- MEDIUM `pointercancel`/`lostpointercapture` → `endDrag` solta o nó.
- MEDIUM `readTexts` sem limites → só notas, ≤ 5 MB, lotes de 64, máx. 20 000 caminhos (teste).
- MEDIUM `setFiles` invalidava todo o índice a cada refresh → mesma lista mantém cache (teste).
- MEDIUM rótulos sem culling → culling de nós e rótulos.
- MEDIUM `fit` nunca rodava se o grafo assentasse escondido; NaN → `onShow` enquadra; guarda de valores não finitos.
- LOW aba escondida recalculava a cada save → marca `stale` e atualiza ao mostrar. Não corrigidos: hover não acompanha nó em movimento sob o cursor parado; texto lido do disco pode sobrescrever um save mais novo no índice por um instante (corrigido pelo próximo evento do watcher).
- Sem testes unitários do VaultStore/GraphView (módulos ESM que dependem de `window`); cobertos pelo smoke no Electron.
