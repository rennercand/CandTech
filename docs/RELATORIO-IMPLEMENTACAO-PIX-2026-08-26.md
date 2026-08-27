# Relatório de implementação e segurança — Pix com comprovante

Data: 26 de agosto de 2026.

## Objetivo executado

Evoluir a cobrança Pix manual existente para receber comprovante privado, permitir conferência administrativa e preservar a regra de que somente uma aprovação humana libera a assinatura. O trabalho foi limitado ao fluxo vendável do piloto; não foram criadas conciliação bancária automática, emissão fiscal ou funções futuras do roadmap.

## Alterações entregues

- seletor de PDF/JPG/PNG/WEBP de até 5 MB em `/assinar`, com envio e substituição;
- estado `payment_review`, separado de `pending` e `approved`;
- upload direto ao Vercel Blob privado com autorização curta e limitada;
- fallback privado em disco apenas para desenvolvimento local;
- validação de nome, tamanho, extensão, MIME e magic bytes, com SHA-256;
- vínculo obrigatório ao proprietário autenticado e ao pagamento ainda aberto;
- metadados versionados no banco, com um único comprovante ativo por cobrança;
- central administrativa com filtro de conferência, pré-visualização e download protegido;
- eventos de auditoria para envio, substituição e visualização;
- aprovação bloqueada sem comprovante ativo;
- migration `20260826_pix_payment_receipts.sql`;
- testes automatizados do fluxo positivo, arquivos falsos, tamanho, travessia, IDOR, substituição e não ativação.

## Achados encontrados e corrigidos durante a revisão

### Limite de 4,5 MB da Vercel Function

O primeiro desenho enviava o binário para uma Route Handler. Isso não atenderia arquivos próximos ao requisito de 5 MB em produção. A correção envia o arquivo diretamente ao Blob privado; a Function gera apenas o token limitado e recebe o callback assinado.

### Troca de comprovante no Postgres

Desativar o comprovante antigo e inserir o novo sem transação poderia violar o índice de único ativo ou deixar estado parcial. A troca passou a ser transacional.

### Aprovação concorrente

Revisar o pagamento e atualizar a assinatura em comandos independentes permitia uma condição de corrida entre aprovação e rejeição. A operação agora é atômica no Postgres e usa `BEGIN IMMEDIATE` no SQLite.

### Falha de auditoria após upload

Uma falha secundária ao registrar o evento não pode apagar um comprovante já vinculado nem informar que o upload falhou. O arquivo permanece válido, a resposta principal continua e a falha de auditoria entra no monitoramento técnico.

### Entrada administrativa inválida

A rota de leitura agora rejeita identificadores fora do formato UUID antes de consultar o banco; as consultas permanecem parametrizadas.

## Verificações executadas

- `npm test`: 82 testes aprovados;
- `npm run build`: build Next.js de produção aprovado, incluindo as duas novas rotas;
- `npm audit --omit=dev`: 0 vulnerabilidades conhecidas;
- `git diff --check`: sem erro de whitespace;
- busca por atribuições de segredos: somente exemplos sem credenciais reais e valores isolados de teste.

## Pendências externas antes do deploy

1. criar/conectar um Vercel Blob **Private** separado em Preview e Production;
2. configurar `BLOB_READ_WRITE_TOKEN` como variável sensível, ou validar a configuração OIDC do store;
3. aplicar `migrations/20260826_pix_payment_receipts.sql` primeiro no Neon de Preview;
4. realizar a homologação completa descrita em `PIX-MANUAL.md`;
5. definir política LGPD de retenção e exclusão dos comprovantes;
6. somente depois aplicar a migration e a variável em Production.

Nenhuma migration de produção, store externo ou deploy foi executado por este trabalho.
