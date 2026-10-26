# Docs

Editor de notas Markdown no estilo Obsidian, com as notas sincronizadas no seu próprio bucket S3.
As notas ficam numa pasta local (funciona offline) e são espelhadas no S3: o que você salva sobe,
o que está no bucket desce. Com versionamento ligado no bucket, toda versão e toda nota apagada
continuam recuperáveis.

## Rodar (Windows, PowerShell)

```powershell
npm install
npm start
```

Rode o `npm install` no Windows, não no WSL: ele baixa o Electron e o esbuild da plataforma onde roda.

## Configurar o S3

1. Credenciais: o app lê o perfil do AWS CLI em `%USERPROFILE%\.aws` (`credentials` e `config`).
2. Bucket (uma vez):
   ```bash
   bash scripts/create-bucket.sh <nome-unico> sa-east-1 default
   ```
   Cria o bucket privado, com versionamento e criptografia. A política IAM mínima está em
   `scripts/iam-policy.json`.
3. No app, em ⚙ Configurações: pasta das notas, bucket, região e perfil. Se a região estiver errada,
   o app encontra a região do bucket sozinho.

## Como o sync funciona

- Ao abrir o app: sincronização completa (sobe o que é novo localmente, baixa o que é novo no bucket).
- Ao salvar: a nota sobe em menos de 1 s. A cada 30 s há uma nova sincronização completa.
- Editou nos dois lados ao mesmo tempo: nada é sobrescrito; a versão remota vira uma cópia
  "nome (conflito data).md" ao lado da sua.
- Apagou: a nota vai para `.trash/` na pasta local e é removida do bucket (recuperável pelo
  versionamento).
- Pastas e arquivos que começam com `.` (incluindo `.obsidian`, `.trash` e `.docs-sync`) não sincronizam.

## Atalhos

| Atalho | Ação |
|---|---|
| Ctrl+N | Nova nota |
| Ctrl+T / Ctrl+W | Nova aba / fechar aba |
| Ctrl+Tab | Próxima aba |
| Ctrl+E | Alternar edição e leitura |
| Ctrl+G | Visualização em gráfico |
| Ctrl+\\ | Recolher/expandir barra lateral |
| Ctrl+clique | Abrir em nova aba |

## Desenvolvimento

- `npm test`: testes (`node --test`) do motor de sync, do vault e do índice de links.
- `npm run build`: empacota o renderer em `dist/renderer`.
- Planejamento (BMAD): `_bmad-output/specs/spec-obsidian-layout-graph/` (`SPEC.md`, `stories.yaml`,
  relatórios de TDD em `tdd/`).
