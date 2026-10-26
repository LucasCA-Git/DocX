---
id: SPEC-obsidian-full-git
companions:
  - ../spec-obsidian-layout-graph/SPEC.md
  - ../spec-obsidian-layout-graph/stack.md
  - /home/lucasalecrim/docs/analise-obsidian.md
sources:
  - "Pedido 2026-10-26: 'faz todas as funcionalidades que existem no obsidian pra ele inclusive algo do git pra colocar ao invés do bucket S3, focar esses documentos online no git utilizando como bucket'"
---

# Docs — paridade com o Obsidian e sync via Git

## Why

O app já tem layout, links, Live Preview, grafo, backlinks e busca. O usuário quer agora o resto do
Obsidian e trocar o S3 por um repositório Git (ex.: repo privado no GitHub) como lugar online das notas:
histórico de versões de graça, sem conta AWS.

## Capabilities

- **CAP-G1 Sync via Git** — o vault é um repositório Git; o app faz commit automático das edições, puxa
  as mudanças do remoto e envia (push). Sem conflito silencioso: quando os dois lados mudaram a mesma nota,
  a versão do remoto vira cópia "(conflito …)", como no sync S3.
  - success: dois clones do mesmo remoto (duas pastas) editam notas diferentes e as duas mudanças chegam
    nas duas pastas; editando a mesma nota surge a cópia de conflito e nada é perdido; offline o app segue
    funcionando e envia quando a rede volta.
- **CAP-G2 Histórico de versões** — para a nota aberta, lista as versões (commits) e permite ver e
  restaurar uma versão anterior.
- **CAP-O1 Paleta de comandos (Ctrl+P) e troca rápida (Ctrl+O).**
- **CAP-O2 Tags e propriedades** — `#tag` e `tags:` no front matter; painel de tags; `aliases:` resolvem
  links e aparecem nas sugestões; propriedades do front matter exibidas como tabela.
- **CAP-O3 Estrutura da nota** — painel Outline (títulos), links de saída, menções não ligadas;
  `[[nota#título]]` e `[[nota#^bloco]]` rolam até o alvo; sugestões de títulos após `#`.
- **CAP-O4 Arquivos** — renomear atualiza os links no vault; colar/arrastar imagem no editor salva no
  vault e insere `![[ ]]`; ordenação do explorador; revelar nota ativa.
- **CAP-O5 Transclusão e prévia** — `![[nota]]` e `![[nota#título]]` mostram o conteúdo; passar o mouse
  sobre um link com Ctrl mostra a prévia da nota.
- **CAP-O6 Markdown completo** — callouts, `==destaque==`, tabelas, notas de rodapé, realce de código,
  Mermaid, matemática (`$…$`, `$$…$$`), checklist clicável no modo leitura.
- **CAP-O7 Editor** — atalhos de formatação (Ctrl+B/I/K…), buscar/substituir na nota, dobrar títulos e
  listas, modo Vim opcional, corretor ortográfico, número de linhas, largura legível, tamanho de fonte.
- **CAP-O8 Notas diárias, modelos, favoritos e nota aleatória.**
- **CAP-O9 Painéis divididos e navegação** — dividir à direita/abaixo, voltar/avançar (Alt+←/→),
  fixar aba.
- **CAP-O10 Grafo avançado** — grupos coloridos por consulta, tags como nós, setas, profundidade do grafo
  local, ajuste das forças.
- **CAP-O11 Busca avançada** — operadores `tag:`, `path:`, `file:`, `"frase exata"`, `-excluir`,
  `/regex/`, `OR`, diferenciar maiúsculas.
- **CAP-O12 Canvas** — arquivos `.canvas` (formato JSON Canvas): cartões de texto, de nota e de link,
  conexões, mover, redimensionar, zoom/pan.
- **CAP-O13 Aparência e exportação** — tema claro/escuro, cor de destaque, fontes; exportar nota para PDF.

## Constraints

- As do SPEC anterior continuam (renderer sandboxed, `.md` puro compatível com o Obsidian, offline-first).
- Git roda pelo `git` do sistema no processo main, com `execFile` (sem shell). Autenticação é do Git
  (Git Credential Manager / chave SSH do usuário): o app nunca guarda nem vê token. URL com credencial
  embutida é recusada. Só os protocolos `https` e `ssh` são permitidos.
- O app não cria repositórios nem mexe na conta do usuário no GitHub: o usuário cria o repo (privado) e
  cola a URL.
- `.trash/`, `.docs-sync/` e temporários nunca vão para o Git (`.git/info/exclude`, sem arquivo no vault).
- S3 continua disponível como alternativa nas configurações (código já testado); Git é o padrão.

## Non-goals

- Plugins da comunidade (executam código sem sandbox no Obsidian; contradiz a constraint de segurança).
- Obsidian Publish/Sync (substituídos pelo Git), app mobile, colaboração em tempo real, Bases, web viewer,
  gravador de áudio.

## Success signal

- O usuário cria um repo privado no GitHub, cola a URL nas configurações, e as notas aparecem lá com
  commits automáticos; em outra pasta apontada para o mesmo repo, as notas descem; os recursos acima
  funcionam no app.

## Assumptions

- Git for Windows instalado (2.49 encontrado) com Git Credential Manager.
- Branch padrão `main`; um commit por rodada de sync, mensagem `vault: <data> (<máquina>)`.
