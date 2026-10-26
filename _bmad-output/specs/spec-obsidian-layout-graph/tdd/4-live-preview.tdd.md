# TDD — História 4: Live Preview

**Fonte:** `stories.yaml` id "4" (CAP-6).

## Desenho
- `shared/live-preview.js` (puro, testado em Node com @lezer/markdown + GFM): da árvore de sintaxe e dos wikilinks gera itens (classe de linha, marca, trecho oculto, widgets de wikilink/embed/marcador/tarefa/linha).
- `renderer/live-preview.js`: ViewPlugin que vira decorações do CodeMirror só nas faixas visíveis; linhas tocadas pela seleção (com foco) mostram a sintaxe crua. HighlightStyle próprio substitui o padrão (que sublinhava títulos).

## Evidência
- RED `Cannot find module '../src/shared/live-preview'` → GREEN 10 testes.
- Electron real: títulos, negrito/itálico/riscado/código, links markdown e wikilinks (inexistente esmaecido), checklist (clique grava `[x]` no arquivo), marcador, citação, linha horizontal, imagem embutida, bloco de código; clique no wikilink abre a nota; sem foco nenhuma linha fica crua.
- Bug visual achado no smoke: regra global `input {width:100%}` deformava os checkboxes → `all: revert`.

## Revisão ecc:code-reviewer (0 CRITICAL, 1 HIGH, 3 MEDIUM, 4 LOW)
- HIGH link markdown com quebra de linha gerava trecho oculto atravessando `\n` → CodeMirror desligava o plugin. Ocultos divididos por linha, widgets multi-linha descartados (teste), e `build` com try/catch.
- MEDIUM front matter YAML virava H2 + linha horizontal → detectado e marcado `lp-frontmatter` (teste).
- MEDIUM checkbox só com mouse → `click` (cobre Espaço), `aria-label`, conferência do texto antes de gravar; wikilink com `role=link`.
- MEDIUM trabalho no documento inteiro por tecla (toString + parseLinks) → não corrigido; aceitável para notas normais.
- LOW sublinhado setext oculto (teste); `[[x]](url)` e tarefa dentro de citação cobertos por teste; listener do store registrado após criar o editor.
- Suíte: 89/89 (inclui testes do grafo em andamento).
