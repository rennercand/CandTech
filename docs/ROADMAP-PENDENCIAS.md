# Pendências verificadas da roadmap — CandTech

Data do recorte: 29/08/2026.

Este arquivo compara as roadmaps com as rotas, bibliotecas, migrations e testes existentes. Ele evita marcar como entregue algo que aparece apenas na interface, em um documento ou como estrutura parcial. As prioridades podem mudar depois de validação comercial, jurídica, contábil ou de segurança.

## Resumo do estado atual

| Área | Estado verificado | Evidência principal |
| --- | --- | --- |
| Autenticação por e-mail, recuperação, MFA e sessão revogável | Entregue para proprietários e equipe administrativa | `app/api/auth/`, `auth_sessions`, `user_mfa`, testes de autenticação |
| Organizações, cargos, permissões e convites | Entregue para o fluxo atual | `organization_*`, `app/api/team/`, testes de equipe |
| Workspace e histórico privado | Entregue, ainda com partes em payload JSON | `app/api/workspace/`, `app/api/history/` |
| Estoque, variações, pedidos e movimentos | Entregue parcialmente | tabelas `inventory_*`, importação e relatórios; faltam FEFO, custo médio e curva ABC |
| Cobrança da CandTech por Pix | Entregue no modelo manual | BR Code/QR, R$ 180 inicial, R$ 60 renovação, comprovante privado e moderação |
| Monitoramento, suporte e administração | Entregue para operação inicial | `monitoring_events`, `support_tickets`, `staff_access` |
| Google Drive e e-mails transacionais | Entregue e endurecido | OAuth `drive.file` com PKCE, nonce persistido de uso único, tokens cifrados e Resend |
| Conciliação financeira vendável | Pendente | não existem importador OFX nem entidades relacionais de conciliação |
| Motor tributário e emissão fiscal | Pendente | somente pré-nota sem validade fiscal |

## P0 — faltas antes de ampliar a comercialização

- [ ] concluir o isolamento relacional por organização para workspace, históricos, clientes, tarefas, entregas e lançamentos que ainda vivem em payloads agregados; **workspace e histórico agora possuem `organization_id`, backfill e índices verificados em Preview/Production, e todas as consultas combinam proprietário + organização derivados da sessão; faltam clientes, tarefas, entregas, financeiro e migração do estoque textual**;
- [ ] adicionar testes sistemáticos de acesso cruzado para cada nova entidade e permissão, não somente para os fluxos já cobertos;
- [ ] transformar `audit_events` em trilha suficiente para operações críticas, com autor, organização, origem, versão e antes/depois minimizado; **estrutura v2, minimização e eventos de autenticação, equipe, aceite jurídico, Pix, Drive e exportações implementados em 29/08/2026; migration aplicada na branch `main` do Neon com 8 colunas verificadas e 63 eventos legados atualizados; falta definir retenção/acesso de consulta**;
- [ ] definir e testar backup completo do Neon e do Blob, restauração, RPO/RTO, retenção, exclusão e continuidade; o ZIP enviado após expiração do Pix não substitui backup da plataforma;
- [ ] confirmar no Neon que a credencial usada pela aplicação não possui privilégios DDL; **verificador CLI e diagnóstico protegido na central privada foram criados; a Vercel bloqueia corretamente a exportação de segredos, então a checagem agora roda dentro do runtime real sem revelar papel ou conexão; falta o proprietário abrir a central e, se reprovada, trocar a credencial**;
- [x] adicionar MFA para proprietário e equipe administrativa; **TOTP com QR, segredo AES-256-GCM, desafio de login de uso único, limite de tentativas, códigos de recuperação em hash e bloqueio server-side das rotas privilegiadas implementados; migration aplicada e verificada no Neon em 30/08/2026**; avaliar SSO/SAML apenas quando houver demanda empresarial;
- [ ] complementar o rate limit no PostgreSQL com proteção na borda/WAF para rotas públicas e autenticação;
- [ ] executar revisão independente e pentest do escopo de produção, além de monitoramento contínuo de dependências e alertas; **Dependabot, `npm audit`, CodeQL e Gitleaks automatizados; revisão independente e pentest continuam externos**;
- [ ] concluir o plano de resposta a incidentes e realizar um exercício documentado; **runbook criado em 29/08/2026; faltam responsáveis nominais privados e o exercício em ambiente isolado**;
- [ ] concluir dados do controlador, contratos com operadores, prazos de retenção e revisão jurídica dos textos LGPD antes da venda ampla.

## P1 — núcleo financeiro vendável

- [ ] criar contas financeiras e lançamentos relacionais por organização, com previsto, realizado, origem e vínculo auditável;
- [ ] importar movimentação financeira em CSV, OFX e XLSX; hoje planilhas atendem principalmente o estoque e o PDF bancário é processado localmente;
- [ ] mostrar prévia financeira, detectar duplicidades por identificador estável e permitir desfazer uma importação inteira;
- [ ] conciliar recebimentos e pagamentos com vendas, compras e contas, mantendo revisão humana para exceções;
- [ ] implementar contas recorrentes e parceladas, pagamento parcial, juros, multa, desconto e inadimplência;
- [ ] adicionar alertas e calendário financeiro, além de previsão de caixa para 7, 30 e 90 dias;
- [ ] criar regras determinísticas de categorização, versionadas, explicáveis e revisáveis pela empresa;
- [ ] implementar idempotência persistida para mutações críticas e uma outbox antes de ampliar integrações e jobs; **tabelas, migration, hashing canônico, replay/conflito e deduplicação foram aplicados no Neon em 30/08/2026; o histórico usa o contrato e cria evento interno, mas faltam as operações críticas, transação domínio+outbox e worker**;
- [ ] paginar listas de crescimento contínuo e medir latência, conexões, tamanho das tabelas e custo do Neon; **histórico ganhou paginação por cursor no banco, API e interface em 30/08/2026, com limite máximo, ordenação determinística e teste multiempresa; faltam as demais listas e as métricas operacionais**.

## P1 — operação de comércio e serviços

- [ ] completar baixa por lote/FEFO, custo médio histórico, curva ABC, itens parados e sugestão de reposição;
- [ ] transformar entregas do workspace em entidades relacionais ligadas a pedido, estoque e cliente, com eventos e comprovante;
- [ ] criar ordem de serviço, orçamento, agenda, recorrência e cobrança de serviços;
- [ ] consolidar venda rápida/PDV com recebimento, caixa, estoque e desfazimento transacional;
- [ ] criar uma tela “Hoje” orientada a ações pendentes, atrasos e exceções;
- [ ] validar concorrência de estoque em cenários paralelos e reforçar idempotência de pedidos e movimentos.

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
