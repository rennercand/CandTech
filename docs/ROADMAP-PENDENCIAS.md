# Pendências verificadas da roadmap — CandTech

Data do recorte: 31/08/2026.

Este arquivo compara as roadmaps com as rotas, bibliotecas, migrations e testes existentes. Ele evita marcar como entregue algo que aparece apenas na interface, em um documento ou como estrutura parcial. As prioridades podem mudar depois de validação comercial, jurídica, contábil ou de segurança.

## Resumo do estado atual

| Área | Estado verificado | Evidência principal |
| --- | --- | --- |
| Autenticação por e-mail, recuperação, MFA e sessão revogável | Entregue para proprietários e equipe administrativa | `app/api/auth/`, `auth_sessions`, `user_mfa`, testes de autenticação |
| Organizações, cargos, permissões e convites | Entregue para o fluxo atual | `organization_*`, `app/api/team/`, testes de equipe |
| Workspace e histórico privado | Entregue; clientes, tarefas, entregas e financeiro usam projeções relacionais | `app/api/workspace/`, `customers`, `operational_tasks`, `operational_deliveries`, `financial_*` |
| Estoque, variações, pedidos, serviços e movimentos | Entregue para o escopo operacional atual | transação serializável, idempotência, FEFO, custo médio histórico, curva ABC, entregas e conclusão de serviços com cobrança |
| Cobrança da CandTech por Pix | Entregue no modelo manual | BR Code/QR, R$ 180 inicial, R$ 60 renovação, comprovante privado e moderação |
| Monitoramento, suporte e administração | Entregue para operação inicial | `monitoring_events`, `support_tickets`, `staff_access` |
| Google Drive e e-mails transacionais | Entregue e endurecido | OAuth `drive.file` com PKCE, nonce persistido de uso único, tokens cifrados e Resend |
| Conciliação financeira vendável | Entregue para o fluxo interno atual | CSV/OFX/XLSX possuem prévia, lote e deduplicação; contas e pedidos recebem sugestões determinísticas com confirmação e desfazimento |
| Motor tributário e emissão fiscal | Pendente | somente pré-nota sem validade fiscal |

## P0 — faltas antes de ampliar a comercialização

- [ ] concluir o isolamento relacional por organização para workspace, históricos, clientes, tarefas, entregas e lançamentos que ainda vivem em payloads agregados; **workspace, histórico, clientes, tarefas, entregas e livro financeiro já possuem escopo relacional, backfill e índices verificados em Preview/Production. No estoque, `organization_id`, backfill e índices foram aplicados nos dois branches; leituras e novas escritas conferem os dois identificadores e o teste cobre duas organizações reais. Falta retirar `tenant_id` somente em deploy futuro, depois de observar a transição**;
- [ ] adicionar testes sistemáticos de acesso cruzado para cada nova entidade e permissão, não somente para os fluxos já cobertos;
- [ ] transformar `audit_events` em trilha suficiente para operações críticas, com autor, organização, origem, versão e antes/depois minimizado; **estrutura v2, minimização e eventos de autenticação, equipe, aceite jurídico, Pix, Drive e exportações implementados em 29/08/2026; migration aplicada na branch `main` do Neon com 8 colunas verificadas e 63 eventos legados atualizados; falta definir retenção/acesso de consulta**;
- [ ] definir e testar backup completo do Neon e do Blob, restauração, RPO/RTO, retenção, exclusão e continuidade; o ZIP enviado após expiração do Pix não substitui backup da plataforma;
- [ ] confirmar no Neon que a credencial usada pela aplicação não possui privilégios DDL; **verificador CLI e diagnóstico protegido na central privada foram criados; a Vercel bloqueia corretamente a exportação de segredos, então a checagem agora roda dentro do runtime real sem revelar papel ou conexão; falta o proprietário abrir a central e, se reprovada, trocar a credencial**;
- [x] adicionar MFA para proprietário e equipe administrativa; **TOTP com QR, segredo AES-256-GCM, desafio de login de uso único, limite de tentativas, códigos de recuperação em hash e bloqueio server-side das rotas privilegiadas implementados; migration aplicada e verificada no Neon em 30/08/2026**; avaliar SSO/SAML apenas quando houver demanda empresarial;
- [ ] complementar o rate limit no PostgreSQL com proteção na borda/WAF para rotas públicas e autenticação;
- [ ] executar revisão independente e pentest do escopo de produção, além de monitoramento contínuo de dependências e alertas; **Dependabot, `npm audit`, CodeQL e Gitleaks automatizados; revisão independente e pentest continuam externos**;
- [ ] concluir o plano de resposta a incidentes e realizar um exercício documentado; **runbook criado em 29/08/2026; faltam responsáveis nominais privados e o exercício em ambiente isolado**;
- [ ] concluir dados do controlador, contratos com operadores, prazos de retenção e revisão jurídica dos textos LGPD antes da venda ampla.

**Controle operacional entregue em 31/08/2026:** a central privada agora verifica, sem revelar valores, a configuração indispensável de banco, sessão, MFA, Pix, Blob, e-mail, administrador, expiração de cobranças, domínio e suporte. Isso reduz erro de configuração, mas não substitui os testes reais, decisões jurídicas, backup/restauração ou pentest listados acima.

## P1 — núcleo financeiro vendável

- [x] criar contas financeiras e lançamentos relacionais por organização, com previsto, realizado, origem e vínculo auditável; **`financial_accounts`, `financial_commitments` e `financial_ledger_entries` foram criadas com backfill, vínculo compromisso/lançamento, deduplicação e teste negativo entre organizações; Preview e Production foram verificados em 31/08/2026**;
- [x] importar movimentação financeira em CSV, OFX/QFX e XLSX; **leitura local no navegador, normalização de datas/valores brasileiros e descarte explicado de linhas inválidas entregues em 31/08/2026**;
- [x] mostrar prévia financeira, detectar duplicidades por identificador estável e permitir desfazer uma importação inteira; **SHA-256 estável, índice único por organização, identificador/data do lote e ação de desfazer o último lote foram testados; migration verificada em Preview e Production em 31/08/2026**;
- [x] conciliar recebimentos e pagamentos com vendas, compras e contas, mantendo revisão humana para exceções; **candidatos um-a-um exigem direção e valor exato, são ordenados por data/texto, exibem motivo/confiança e só dão baixa após confirmação; o vínculo pode ser desfeito sem apagar o lançamento**;
- [x] implementar contas recorrentes e parceladas, pagamento parcial, juros, multa, desconto e inadimplência; **séries finitas semanais, mensais ou anuais preservam vencimentos de fim de mês; baixas parciais criam lançamentos vinculados, o saldo considera ajustes sem alterar o valor-base e vencidos exibem quantidade e valor em aberto. Migration e backfill foram verificados em Preview e Production em 31/08/2026**;
- [x] adicionar alertas e calendário financeiro, além de previsão de caixa para 7, 30 e 90 dias; **a agenda ordena vencidos e próximos compromissos, destaca hoje e os próximos sete dias, e projeta o saldo realizado somando recebíveis e subtraindo pagamentos ainda abertos em cada horizonte; regra determinística coberta por teste em 31/08/2026**;
- [x] criar regras determinísticas de categorização, versionadas, explicáveis e revisáveis pela empresa; **regras por termo e tipo são persistidas por organização, mostram a justificativa antes da aplicação humana e gravam identificador/versão no lançamento classificado**;
- [ ] implementar idempotência persistida para mutações críticas e uma outbox antes de ampliar integrações e jobs; **histórico, estoque e ordens de serviço exigem chave persistida, com replay e conflito. Venda/compra, baixa/entrada, pedidos e conclusão de serviço usam transações serializáveis e outbox; repetição não movimenta saldo nem cria cobrança novamente. O worker protegido por `CRON_SECRET` possui claim exclusivo, tentativas e backoff. Ainda faltam aplicar o mesmo contrato à moderação de pagamentos e demais mutações críticas**;
- [ ] paginar listas de crescimento contínuo e medir latência, conexões, tamanho das tabelas e custo do Neon; **histórico ganhou paginação por cursor no banco, API e interface em 30/08/2026, com limite máximo, ordenação determinística e teste multiempresa; faltam as demais listas e as métricas operacionais**.

## P1 — operação de comércio e serviços

- [x] completar baixa por lote/FEFO, custo médio histórico, curva ABC, itens parados e sugestão de reposição; **vendas agora distribuem a baixa pelos saldos de lote na ordem de validade, desfazimentos restauram os lotes e cancelam o pedido, o custo médio pondera entradas ativas e a visão geral exibe ABC por faturamento, 90 dias sem venda e quantidade para recompor o mínimo; cenários integrados e regras determinísticas possuem testes**;
- [x] transformar entregas do workspace em entidades relacionais ligadas a pedido, estoque e cliente, com eventos e comprovante; **a entidade relacional, a interface operacional, os vínculos com cliente e pedido, o rastreio, a conclusão e o comprovante privado estão ativos; cada nova venda cria atomicamente uma entrega e o evento `delivery.created`, o cancelamento da venda cancela a entrega e cada transição posterior publica `delivery.status_changed` pela outbox**;
- [x] criar ordem de serviço, orçamento, agenda, recorrência e cobrança de serviços; **a tela operacional e a API relacionam cliente, responsável, agenda, local, serviços e materiais. O fluxo orçamento → aprovação → agenda → execução → conclusão exige idempotência; ao concluir, baixa lotes por FEFO, calcula custo/margem, cria conta a receber e agenda o próximo ciclo na mesma transação, com rollback integral por saldo insuficiente e eventos na outbox**;
- [x] consolidar venda rápida/PDV com recebimento, caixa, estoque e desfazimento transacional; **o PDV aceita leitura por SKU/EAN, cliente cadastrado ou avulso, dinheiro, Pix, débito, crédito, transferência ou venda a prazo. Venda paga cria lançamento no caixa; pendente cria conta a receber; estoque FEFO, pedido, entrega, financeiro e outbox compartilham a transação. O desfazimento restaura o estoque, cancela entrega/conta pendente ou cria lançamento financeiro inverso. Desconto exige permissão independente**;
- [x] criar uma tela “Hoje” orientada a ações pendentes, atrasos e exceções; **a home reúne vendas e margem do dia, valores vencidos/para hoje, inadimplência, reposição, validade, serviços agendados/atrasados, conclusões sem cobrança e conferência do caixa esperado versus contado. Cada leitura respeita as permissões do funcionário, cada alerta abre o módulo de resolução e as conferências ficam em histórico relacional com autor e auditoria**;
- [ ] validar concorrência de estoque em cenários paralelos e reforçar idempotência de pedidos e movimentos; **pedido e movimentos já são atômicos, serializáveis e deduplicados por organização; testes cobrem replay, saldo insuficiente sem efeito parcial e outbox única. Ainda falta um teste de concorrência real contra Postgres com requisições paralelas**.

## P2/P3 — diferenciação e integrações

- [ ] conciliação bancária administrativa e, somente depois, Open Finance com consentimento, revogação e idempotência;
- [ ] Pix Cobrança ou Pix Automático com integração bancária e webhook autenticado; o fluxo atual continua manual;
- [ ] diagnóstico versionado de IBS/CBS, com memória de cálculo e validação contábil;
- [ ] simulador visual de split payment sem executar recolhimento real;
- [ ] campos fiscais de empresa, cliente e produto, incluindo NCM/CEST quando aplicável;
- [ ] prova de conceito de NF-e/NFC-e em homologação por provedor, com certificado protegido, XML, protocolo e eventos;
- [ ] NFS-e como integração separada, conforme os canais e regras municipais/nacionais aplicáveis;
- [ ] API pública e webhooks com escopos, assinatura, reprocessamento, limites e auditoria;
- [ ] integrações com e-commerce, marketplaces, transportadoras e contador somente após o núcleo transacional estar estável.

## Ordem recomendada a partir deste recorte

1. Continuidade, isolamento, auditoria e validação independente.
2. Livro financeiro relacional, importação e conciliação.
3. Contas recorrentes, previsão e regras determinísticas.
4. Completar estoque, serviços e entregas relacionais.
5. Medir o piloto; só então iniciar IBS/CBS, fiscal, Open Finance e split payment.

## Documentos relacionados

- [Roadmap do produto](./ROADMAP-PRODUTO.md)
- [Roadmap SaaS para comércio e serviços](./ROADMAP-SAAS-COMERCIO-SERVICOS.md)
- [Roadmap de segurança](./ROADMAP-SEGURANCA.md)
- [Correções de segurança verificadas](./ROADMAP-CORRECOES-SEGURANCA.md)
- [Checklist antes de vender](./CHECKLIST-ANTES-DE-VENDER.md)
- [Arquitetura e fluxos](./ARQUITETURA.md)
