# Meta atual — piloto comercial acompanhado

Definida pelo responsável em 09/09/2026: preparar o essencial para vender a versão piloto, antes de ampliar funcionalidades das roadmaps.

## Escopo

Estoque e alertas, clientes, vendas/serviços, financeiro, equipe com permissões e assinatura Pix manual. Não prometer emissão fiscal, integração bancária automática, disponibilidade garantida ou certificação de segurança. O piloto não dispensa proteção de dados nem recuperação testada.

## Critérios de liberação

- [x] Central raiz com MFA: envio manual de ZIP ao e-mail verificado do titular, confirmação, limite de frequência, auditoria e proteção persistida contra repetição; testado com provedor simulado, sem envio real. Lista privada de atividade de sessões nos últimos 15 minutos com nome/empresa e paginação. Validação desta entrega: 141 testes, build e 45 verificações HTTP locais aprovados; consultar o CI para auditoria/deploy atuais.

- [x] Atualizar Next.js para 16.3.4 e Sharp para 0.35.4; auditoria local sem vulnerabilidades conhecidas em 09/09/2026.
- [x] Validar build, 140 testes automatizados e 42 verificações HTTP locais de autenticação/isolamento, incluindo o download ZIP. Os bancos destes testes são SQLite temporários, não o Neon de produção.
- [x] Disponibilizar exportação ZIP autenticada para o proprietário com MFA, sem anexar dados financeiros aos e-mails; documentar conteúdo, limite e ausência de importador/restauração completa.
- [x] Minimizar novos tokens: sem nome/e-mail, identidade e permissões verificadas no servidor; testar sessão revogada e conta suspensa.
- [x] Confirmar CI e deploy da correção de dependências no domínio oficial: commit `60bcf83`, READY em 09/09/2026. Cada entrega posterior exige nova validação.
- [ ] Conferir na central privada ausência de bloqueios de configuração, incluindo assinatura obrigatória e credencial de banco sem DDL.
- [ ] Confirmar entrega real de verificação de e-mail, recuperação e convite com contas de teste autorizadas.
- [ ] Validar o ciclo comercial: primeira cobrança R$ 180, conferência no banco pelo responsável, ativação e próxima cobrança R$ 60; comprovante sozinho não autoriza aprovação. Não gerar pagamento real sem decisão do responsável.
- [ ] Restaurar backup de Neon e arquivos privados em ambiente isolado, registrar integridade e tempo de recuperação. Exportação de conta não substitui esse teste.
- [ ] Testar concorrência real de estoque no PostgreSQL isolado, sem usar dados de clientes.
- [ ] Definir responsável pelo suporte/incidentes, contato, condições comerciais, identificação do controlador e revisão dos textos aplicáveis.

Itens abertos exigem evidência antes de serem marcados como concluídos. Não registrar credenciais ou dados de clientes neste documento. Evidências operacionais sensíveis ficam em local privado, com referência anonimizada aqui.

## Operação inicial

Começar com entrada acompanhada de clientes, volume compatível com suporte disponível e conferência diária de erros, cobranças e estoque. Se houver acesso cruzado, cobrança duplicada ou perda de dados, interromper novas entradas/cobranças afetadas e seguir o plano de incidentes. Não ampliar a venda enquanto esses bloqueios persistirem.

Adiar fiscal, Open Finance, marketplaces, API pública e novas integrações. Retomar essas roadmaps somente após estabilizar o piloto e medir a demanda.

## Referências

- [Guia de acesso seguro, ZIP e liberação de clientes](./GUIA-ACESSO-E-BACKUP-PILOTO.md)

- [Checklist comercial](./CHECKLIST-ANTES-DE-VENDER.md)
- [Pendências técnicas](./ROADMAP-PENDENCIAS.md)
- [Backup e restauração](./BACKUP-E-RESTAURACAO.md)
- [Validação de tokens e isolamento](./VALIDACAO-TOKEN-E-ISOLAMENTO.md)
- [Auditoria de exposição](./AUDITORIA-EXPOSICAO-DADOS.md)
- [Resposta a incidentes](./PLANO-RESPOSTA-INCIDENTES.md)
