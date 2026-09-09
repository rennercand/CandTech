# Backup e restauração — CandTech

**Atualização de 09/09/2026:** a exportação da conta agora tem download autenticado em `/exportar-dados`, exclusivo do proprietário com MFA e limite de resposta de 4 MiB. O e-mail de expiração passa a enviar apenas orientação para esse download, não um ZIP anexado. Referências históricas ao envio de ZIP abaixo descrevem o fluxo anterior. Veja o [guia de configuração e acesso](./GUIA-ACESSO-E-BACKUP-PILOTO.md).

Versão inicial: 29/08/2026. Estado: política e critérios definidos; restauração completa do Neon e do Blob ainda precisa ser executada e cronometrada em ambiente isolado.

## Metas provisórias do piloto

- **RPO:** até 24 horas de dados.
- **RTO:** até 8 horas para restabelecer o núcleo autenticado.
- **Retenção operacional:** 30 dias de backups diários e 12 cópias mensais, sujeita à validação jurídica e contratual.
- **Separação:** Production e Preview nunca compartilham banco, Blob ou credenciais de gravação.

Essas metas precisam ser aprovadas pelo responsável do negócio antes da venda ampla.

## Escopo mínimo

O backup da plataforma inclui schema e dados do Neon, objetos privados do Vercel Blob, manifesto com data/ambiente/contagens/hashes e a versão Git correspondente. O ZIP enviado ao cliente quando a assinatura expira é portabilidade da conta e não substitui este backup.

Segredos, tokens de sessão, arquivos `.env` e credenciais não entram no pacote. O backup deve ser cifrado fora do ambiente de produção e acessível somente a pessoas nomeadas.

## Procedimento de cópia

1. Gerar dump consistente do Neon com ferramenta suportada pelo PostgreSQL, sem registrar a URL de conexão.
2. Listar objetos do Blob privado por paginação e copiar conteúdo, caminho, tamanho e hash.
3. Criar manifesto com o commit publicado, horário UTC, ambiente e totais.
4. Cifrar o pacote e enviá-lo para destino separado da conta/projeto principal.
5. Validar que o pacote abre, que os hashes conferem e que a retenção remove somente cópias vencidas.

## Teste de restauração

1. Criar banco e Blob vazios e isolados.
2. Restaurar schema antes dos dados e aplicar apenas migrations posteriores ao ponto restaurado.
3. Restaurar objetos privados mantendo caminhos e metadados.
4. Executar `npm test`, `npm run build` e os testes de duas organizações.
5. Conferir contagens de usuários, organizações, documentos, pedidos, movimentos, cobranças e comprovantes.
6. Abrir amostras sintéticas e comparar hashes, sem usar dados pessoais em relatórios.
7. Registrar duração real, ponto mais recente recuperado e qualquer divergência.

Uma cópia que nunca passou por este procedimento não conta como backup validado. A restauração em Production exige autorização explícita do responsável técnico e do controlador dos dados.

## Portabilidade da conta: correção local

A exportação ZIP percorre as páginas do histórico em vez de limitar o conteúdo aos primeiros 50 documentos. O teste inclui 56 documentos da empresa A e um documento da empresa B, confirmando inclusão completa desse histórico e exclusão dos dados de B. Para o envio por e-mail, há limites explícitos de 10.000 documentos, 32 MiB de JSON não comprimido e 15 MiB de ZIP; excedê-los gera erro, não um arquivo silenciosamente incompleto. Essa exportação não é snapshot transacional entre todos os módulos, não inclui toda a plataforma nem comprova restauração de Neon/Blob.

## Exclusão e LGPD

Pedidos válidos de exclusão são aplicados primeiro aos sistemas ativos. Cópias imutáveis continuam bloqueadas para uso comum e expiram pelo ciclo técnico definido; uma restauração não pode reativar dados já eliminados, portanto o registro de supressão deve ser reaplicado antes de liberar o ambiente recuperado.
