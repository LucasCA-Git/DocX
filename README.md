# Docs

Editor de notas Markdown no estilo Obsidian. As notas ficam numa pasta local (funciona offline) e
são sincronizadas com um repositório Git seu (ex.: repositório privado no GitHub), com histórico de
versões de cada nota. O S3 continua disponível como alternativa.

## Rodar (Windows, PowerShell)

```powershell
npm install
npm start
```

Rode o `npm install` no Windows, não no WSL: ele baixa o Electron e o esbuild da plataforma onde roda.

## Configurar o Git (padrão)

1. Crie um repositório **privado e vazio** no GitHub (ou GitLab etc.).
2. Tenha o Git for Windows instalado (vem com o Git Credential Manager).
3. No app, em ⚙ Configurações › Vault e sincronização: escolha a pasta, "Git", cole a URL
   (`https://github.com/voce/notas.git` ou `git@github.com:voce/notas.git`) e a branch (`main`).
4. Na primeira sincronização o Git pede o login (janela do Git Credential Manager). O app nunca vê
   nem guarda senha ou token; URL com usuário/senha embutidos é recusada.

Como funciona: a pasta vira um repositório Git. A cada edição (e a cada 30 s) o app faz commit,
busca o que mudou no remoto, junta e envia. Se a mesma nota mudou nos dois lados, a versão remota
vira "nota (conflito data).md" ao lado da sua — nada é perdido. Offline, os commits ficam locais e
sobem quando a rede volta. Pastas/arquivos que começam com `.` não vão para o Git.
Histórico: menu ⋮ da nota › Histórico de versões (ver diferenças e restaurar).

## Configurar o S3 (alternativa)

1. Credenciais: o app lê o perfil do AWS CLI em `%USERPROFILE%\.aws` (`credentials` e `config`).
2. Bucket (uma vez):
   ```bash
   bash scripts/create-bucket.sh <nome-unico> sa-east-1 default
   ```
   Cria o bucket privado, com versionamento e criptografia. A política IAM mínima está em
   `scripts/iam-policy.json`.
3. No app, em ⚙ Configurações: pasta das notas, bucket, região e perfil. Se a região estiver errada,
   o app encontra a região do bucket sozinho.

## Como o sync S3 funciona

- Ao abrir o app: sincronização completa (sobe o que é novo localmente, baixa o que é novo no bucket).
- Ao salvar: a nota sobe em menos de 1 s. A cada 30 s há uma nova sincronização completa.
- Editou nos dois lados ao mesmo tempo: nada é sobrescrito; a versão remota vira uma cópia
  "nome (conflito data).md" ao lado da sua.
- Apagou: a nota vai para `.trash/` na pasta local e é removida do bucket (recuperável pelo
  versionamento).
- Pastas e arquivos que começam com `.` (incluindo `.obsidian`, `.trash` e `.docs-sync`) não sincronizam.

## Atalhos

Todos os comandos estão na paleta (Ctrl+P) e os atalhos podem ser mudados em Configurações ›
Atalhos de teclado.

| Atalho | Ação |
|---|---|
| Ctrl+P | Paleta de comandos |
| Ctrl+O | Troca rápida (abrir/criar nota) |
| Ctrl+N | Nova nota |
| Alt+D | Nota diária de hoje |
| Alt+T | Inserir modelo |
| Ctrl+Shift+F | Buscar no vault (`tag:`, `path:`, `file:`, `"frase"`, `-excluir`, `OR`, `/regex/`) |
| Ctrl+G | Visualização em gráfico |
| Ctrl+Shift+B | Barra lateral direita (backlinks, links de saída, estrutura, tags, grafo local) |
| Ctrl+E | Alternar edição e leitura |
| Ctrl+B / Ctrl+I / Ctrl+K | Negrito / itálico / link |
| Ctrl+L | Alternar caixa de seleção |
| Ctrl+H | Buscar e substituir na nota |
| Ctrl+T / Ctrl+W | Nova aba / fechar aba |
| Alt+← / Alt+→ | Voltar / avançar |
| Ctrl+, | Configurações |
| Ctrl+clique | Seguir link / abrir em nova aba |

## Desenvolvimento

- `npm test`: testes (`node --test`) dos motores de sync (Git e S3), do vault, do índice de links e
  dos módulos de Markdown, busca, grafo e canvas.
- `npm run build`: empacota o renderer em `dist/renderer`.
- Planejamento (BMAD): `_bmad-output/specs/spec-obsidian-layout-graph/` (fase 1) e
  `_bmad-output/specs/spec-obsidian-full-git/` (paridade com o Obsidian e Git).
