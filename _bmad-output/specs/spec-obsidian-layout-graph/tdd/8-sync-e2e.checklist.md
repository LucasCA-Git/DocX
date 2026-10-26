# História 8 — Verificação ponta a ponta do sync com o bucket real

**Fonte:** `stories.yaml` id "8" (CAP-5). done_checkpoint: executado pelo usuário (o código não toca na AWS por conta própria).
**Já coberto por testes automáticos (S3 simulado, test/sync-engine.test.js):** upload/restauração, dotfiles fora, edição local sobe, sync sem mudanças não faz nada, exclusão (outro dispositivo manda para .trash), edição vence exclusão, conflito vira cópia "(conflito …)", escrita condicional com retry, estado por bucket/prefixo.

## Roteiro (bucket docs3lucasalecrim, sa-east-1)

1. **Pasta vazia baixa tudo**
   - Configurações → Pasta das notas: uma pasta nova e vazia (ex.: `Documents\docs-teste`); bucket `docs3lucasalecrim`, perfil `default`.
   - Esperado: status "Sincronizado"; notas e imagens do bucket aparecem no explorador; grafo mostra as ligações; imagens abrem.
2. **Edição sobe em segundos**
   - Edite uma nota e espere ~5 s.
   - Esperado: `aws s3 ls s3://docs3lucasalecrim/ --recursive` mostra a data nova; `aws s3 cp s3://docs3lucasalecrim/<nota>.md -` mostra o texto novo.
3. **Anexo incluído**
   - Copie uma imagem para a pasta do vault pelo Explorer do Windows e use `![[nome.png]]` numa nota.
   - Esperado: a imagem aparece no Live Preview e o arquivo aparece no `aws s3 ls`.
4. **Exclusão**
   - Exclua uma nota pelo app.
   - Esperado: some do bucket; local vai para `.trash` dentro do vault.
5. **Dois dispositivos / conflito** (opcional: segunda pasta apontando para o mesmo bucket)
   - Edite a mesma nota nas duas pastas antes de sincronizar.
   - Esperado: uma cópia "(conflito AAAA-MM-DD HHMMSS)" aparece e um aviso é mostrado; nada é perdido.
6. **Offline**
   - Desligue a rede, edite, religue.
   - Esperado: status de erro enquanto offline; ao voltar, a edição sobe no próximo ciclo (≤ 30 s).

## Resultado
- [ ] 1  - [ ] 2  - [ ] 3  - [ ] 4  - [ ] 5  - [ ] 6
