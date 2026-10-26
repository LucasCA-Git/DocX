---
id: SPEC-obsidian-layout-graph
companions:
  - stack.md
  - brownfield.md
  - architecture-diagrams.md
  - /home/lucasalecrim/docs/analise-obsidian.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# Docs — layout estilo Obsidian, Graph View e links no texto

## Why

Visão a realizar: o usuário quer um Obsidian pessoal cujas notas vivem no próprio bucket S3 (`docs3lucasalecrim`, sa-east-1), para nunca perdê-las. O MVP já edita e sincroniza, mas não parece nem funciona como o Obsidian: faltam o layout (ribbon, explorador, abas), os links entre notas no texto e o grafo que mostra essas conexões — o motivo de usar um Obsidian.

## Capabilities

- **CAP-1**
  - **intent:** O usuário trabalha num workspace com o layout do Obsidian: ribbon de ícones à esquerda, explorador de arquivos com pastas recolhíveis, abas de notas e do grafo no topo, barra de status embaixo.
  - **success:** Com 3 notas em 2 pastas, dá para recolher/expandir pastas, criar nota e pasta pelo explorador, abrir 2 notas e o grafo em abas distintas, alternar e fechar abas; a status bar mostra o estado do sync.
- **CAP-2**
  - **intent:** O usuário liga notas escrevendo `[[nota]]`, `[[nota|apelido]]` ou `[[nota#título]]`, com sugestões de notas ao digitar `[[`, e navega pelo link.
  - **success:** Digitar `[[Dep` sugere "Deploy Front_End"; aceitar insere o link; clicar no link no preview (ou Ctrl+clique no editor) abre a nota; link para nota inexistente aparece diferenciado e, ao clicar, cria a nota.
- **CAP-3**
  - **intent:** O usuário incorpora anexos com `![[arquivo.png]]` e vê a imagem no preview.
  - **success:** Uma imagem do vault referenciada por `![[Terminus SFTP.png]]` aparece renderizada no preview; uma referência a arquivo inexistente mostra aviso em vez de quebrar.
- **CAP-4**
  - **intent:** O usuário abre o Graph View e vê todas as notas e anexos como nós ligados pelos seus links e embeds.
  - **success:** Para o vault da screenshot de referência, o grafo mostra as mesmas arestas (ex.: Deploy Front_manual ligado aos dois .png, que aparecem em amarelo); clicar num nó abre a nota; zoom, pan e arrastar nós funcionam; adicionar um link numa nota reflete no grafo aberto em até 2 s.
- **CAP-5**
  - **intent:** Tudo o que o usuário escreve ou anexa vai para o S3, e tudo o que está no bucket aparece no app, ao iniciar e continuamente.
  - **success:** Numa pasta vazia apontada para o bucket, ao iniciar o app as notas e imagens do bucket aparecem; uma edição salva aparece no S3 em segundos; a status bar mostra sincronizado/erro com a mensagem.
- **CAP-6**
  - **intent:** O usuário edita com Live Preview: o Markdown aparece formatado enquanto digita, e a linha com o cursor mostra a sintaxe crua.
  - **success:** Títulos, negrito, itálico, listas, código, links `[[ ]]` (clicáveis) e imagens `![[ ]]` aparecem formatados fora da linha do cursor; na linha do cursor a sintaxe é editável; Ctrl+E alterna para o modo leitura.
- **CAP-7**
  - **intent:** O usuário vê, num painel, quais notas apontam para a nota aberta.
  - **success:** Abrindo "Deploy Ambiente Geral", o painel lista as notas que têm `[[Deploy Ambiente Geral]]`; clicar abre a nota; a lista atualiza ao salvar um link novo.
- **CAP-8**
  - **intent:** O usuário vê o grafo local da nota aberta: ela e as notas ligadas a ela.
  - **success:** O grafo local de "Deploy Front_End" mostra só ela e os vizinhos diretos; ao trocar de nota, o grafo acompanha.
- **CAP-9**
  - **intent:** O usuário busca texto em todas as notas do vault.
  - **success:** Buscar "sftp" lista as notas que contêm o termo, com o trecho encontrado; clicar abre a nota.

## Constraints

- Renderer sandboxed (contextIsolation, sem Node, CSP `connect-src 'none'`): arquivos e AWS só via processo main e preload; o renderer nunca vê credenciais.
- O vault continua sendo arquivos `.md` puros com a sintaxe de links do Obsidian: a mesma pasta deve abrir no Obsidian sem conversão.
- Offline-first: o app funciona sem rede; o S3 é espelho e backup, não a única cópia.
- Escrita no S3 nunca sobrescreve versão remota mais nova em silêncio (regra existente do motor de sync: cópia "conflito").

## Non-goals

- Sistema de plugins.
- Canvas, Publish, mobile.
- Colaboração em tempo real.
- Temas customizáveis (só o tema escuro atual).

## Success signal

- Numa máquina nova, o usuário aponta o app para uma pasta vazia e o bucket; as notas aparecem no explorador, ele escreve `[[Deploy Back_End]]` numa nota e vê a nova aresta no Graph View, e a edição está no S3.

## Assumptions

- Vault pessoal de até ~2000 notas; o grafo e a busca devem continuar fluidos nessa escala.
- O vault é uma pasta nova (`Documents\docs`); o vault atual do Obsidian não é tocado.
