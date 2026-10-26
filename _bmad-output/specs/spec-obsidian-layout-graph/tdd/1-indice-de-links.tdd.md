# TDD — História 1: índice de links

**Fonte:** `stories.yaml` id "1" (CAP-2, CAP-4, CAP-7, CAP-8 de `SPEC.md`). Sem checkpoints git: o usuário não pediu commits.

## Jornadas
- Como usuário, quero que `[[nota]]`, `[[nota|apelido]]`, `[[nota#título]]` e `![[img.png]]` sejam reconhecidos para virarem links e arestas.
- Como usuário, quero que um link ache a nota pelo nome em qualquer pasta, como no Obsidian.
- Como usuário, quero backlinks e grafo global/local derivados desses links.

## Evidência
- **RED:** `node --test test/links.test.js` com esqueleto que lança "não implementado" → `# tests 20 # pass 0 # fail 20`, todos com `error: 'não implementado'`. (Execução anterior sem o módulo falhou por import e não foi contada como RED.)
- **GREEN:** mesmo comando após `src/shared/links.js` → `# tests 20 # pass 20 # fail 0`.
- **Suíte completa + cobertura:** `node --test --experimental-test-coverage "test/**/*.test.js"` → 32/32; `links.js` 96,50% linhas, 94,29% branches.
- **Desempenho (assumption de ~2000 notas):** indexar 2000 notas com 5 links cada + grafo = 71 ms; edição incremental + grafo + backlinks = 29 ms.

## Garantias
| # | Garantia | Teste |
|---|---|---|
| 1 | Links simples, com apelido, título e embed são reconhecidos | `parses plain, aliased, heading and embed links` |
| 2 | Posição do link no texto é exata (base para Ctrl+clique e Live Preview) | `reports the source range of each link` |
| 3 | Links em blocos de código e código inline são ignorados | `ignores links inside fenced and inline code` |
| 4 | Resolução por nome, sem diferenciar maiúsculas, em qualquer pasta | `resolves by note name…` |
| 5 | Nomes repetidos: pasta da nota de origem, depois raiz, depois menor caminho | `with duplicate names…` |
| 6 | Backlinks corretos e atualizados após edição, remoção e criação do alvo | `backlinks…`, `updating…`, `removing…`, `links resolve again…` |
| 7 | Grafo: nó por arquivo (nota/anexo), arestas sem duplicar ida e volta, não resolvidos opcionais | `graph…`, `mutual links…`, `graph can include unresolved…` |
| 8 | Grafo local = nota + vizinhos diretos | `local graph…` |

## Lacunas conhecidas
- Linhas não cobertas: resolução por caminho parcial com `/` (suffix match) e `outgoing()`/`resolve()`, que serão exercitados pelas histórias 3 e 6.
- Revisão `ecc:code-reviewer` em andamento; achados serão registrados aqui.

## Revisão ecc:code-reviewer (WARNING: 3 HIGH, 3 MEDIUM, 2 LOW) — corrigida
- **RED:** 10 testes de regressão adicionados; 6 falharam (`# tests 30 # pass 24 # fail 6`): inline code com vários backticks, inline code entre linhas, fence de fechamento com info string, `\|` em tabela, `./`/`../`, desempenho (edição com 2000 notas e links com `/`, antes ~8,3 s).
- **GREEN:** `node --test --experimental-test-coverage "test/**/*.test.js"` → `# tests 45 # pass 45 # fail 0`; `links.js` 98,50% linhas.
- Mudanças: mascaramento de código segue CommonMark (runs de N backticks no parágrafo; fence só fecha sem info string e com comprimento ≥); `\|` vira separador; caminhos `./`/`../` resolvidos contra a pasta de origem; índice de sufixos substitui a busca linear; edição re-resolve só a nota editada; grafo e mapa de vizinhos em cache por versão; frontier do grafo local deduplicado.
- Teste de desempenho (`editing one note stays fast…`) exige < 300 ms e passa.
