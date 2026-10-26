# TDD — História 2: layout do workspace

**Fonte:** `stories.yaml` id "2" (CAP-1). Sem checkpoints git: o usuário não pediu commits.

## Evidência
- **Vault (TDD):** `listTree`/`mkdir` — RED `# pass 0 # fail 3` (`vault.listTree is not a function`), GREEN 3/3.
- **Regressões da revisão (TDD):** nomes com "." e rename só de maiúsculas — RED `# fail 1` (`Missing expected rejection.`), GREEN; suíte `node --test "test/**/*.test.js"` → 47/47.
- **UI:** sem testes automatizados de renderer; verificada por screenshots do Chrome headless do Windows com `window.docs` simulado (vault igual à screenshot do usuário): abas (2 notas + grafo), explorador recolhível com tags PNG, modo leitura com wikilinks (não resolvido esmaecido), menu de contexto, nova pasta com renomear inline, status bar.

## Revisão ecc:code-reviewer (0 CRITICAL, 2 HIGH, 7 MEDIUM, 7 LOW) — corrigida
- HIGH troca de nota com save falho descartava texto → `save()` devolve sucesso; `navigate`/`go` só trocam se salvou.
- HIGH fechar janela perdia digitação → main segura o `close`, pede `app:before-close`, renderer salva tudo em paralelo e responde `app:close-ready` (timeout 3 s).
- MEDIUM delete fechava aba antes de excluir → espera saves em voo, exclui, só então fecha.
- MEDIUM `load()` trocava path antes do conteúdo → path muda só após leitura com sucesso.
- MEDIUM `reloadIfClean` sem guarda → compara path e loadToken após o await.
- MEDIUM input de renomear recriado → render adiado durante rename.
- MEDIUM `store.refresh` fora de ordem → contador de geração.
- MEDIUM rename só de maiúsculas no Windows → rename via nome temporário.
- MEDIUM `<style>` no preview → `FORBID_TAGS/FORBID_ATTR: style`.
- LOW corrigidos: aba ativa restaurada, subpastas abertas após renomear/mover, reveal só ao trocar de nota, nomes com "." rejeitados, tmp único por escrita, saves serializados por aba.
- LOW não corrigido: a mesma nota pode ficar aberta em duas abas pelo histórico voltar/avançar (último save vence).
