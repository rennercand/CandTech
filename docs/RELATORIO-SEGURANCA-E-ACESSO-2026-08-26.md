# Relatório de segurança e acesso interno — 26/08/2026

## Escopo revisado

- autenticação, sessão revogável, verificação de e-mail e aceite jurídico;
- central de incidentes, chamados e aprovação Pix;
- leitura privada de comprovantes;
- criação e revogação de acessos da equipe;
- isolamento entre conta interna e módulos pagos do ERP.

## Falha encontrada

O modelo anterior concentrava todos os poderes em `ADMIN_EMAILS`: qualquer administrador via incidentes, chamados e comprovantes e podia aprovar cobranças. Isso contrariava o privilégio mínimo e aumentava o impacto de uma conta comprometida. Além disso, uma futura conta de suporte sem assinatura ficaria bloqueada na tela de cobrança.

## Correções implementadas

- tabela `staff_access` vinculada ao `user_id` imutável de uma conta existente e verificada;
- permissões independentes `can_monitor`, `can_support` e `can_billing`;
- somente a raiz `ADMIN_EMAILS` recebe `canManageStaff` e altera a equipe;
- APIs filtram a leitura e recusam mutações de módulos não concedidos com `403`;
- comprovantes Pix exigem `canBilling`, além de sessão, rate limit e resposta sem cache;
- central exige e-mail verificado e aceite jurídico atual;
- revogação é consultada no banco em toda requisição e não depende de encerrar a sessão;
- colaborador sem assinatura recebe apenas um atalho para a central, sem acesso ao ERP financeiro;
- concessões, alterações, revogações e visualizações de comprovante geram auditoria sem registrar senha.

## Operação segura

Cada colaborador cria a própria conta e senha e confirma o próprio e-mail. O administrador principal concede a função pelo e-mail em **Central privada → Equipe interna**. Não existe senha administrativa compartilhada nem senha criada pelo gestor. Recuperações usam o fluxo **Esqueci minha senha**.

## Limites remanescentes

- o PostgreSQL ainda depende do isolamento no servidor e não possui RLS versionado; a evolução está documentada em `SEGURANCA-DO-BANCO.md`;
- MFA ainda não está disponível e deve ser priorizado antes de ampliar o produto além do piloto;
- a aprovação Pix continua humana e exige conferência no banco; o comprovante, isoladamente, não prova liquidação;
- retenção e anonimização dos chamados ainda precisam de prazo formal validado juridicamente.

## Validação executada

- `npm test`: 84 testes aprovados, sem falhas;
- `npm audit --omit=dev`: nenhuma vulnerabilidade conhecida nas dependências de produção;
- `npm run build`: build de produção concluído e 48 rotas verificadas pelo Next.js;
- teste isolado com conta de suporte sem assinatura: somente a aba **Mensagens** ficou disponível;
- tentativas dessa conta de listar equipe, abrir comprovante e aprovar Pix retornaram `403`;
- conta raiz visualizou os três módulos e o painel **Equipe interna**;
- acesso anônimo às APIs administrativas do deploy de Preview foi recusado;
- CSP com nonce, HSTS, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, `noindex` e respostas sem cache foram conferidos no deploy;
- Blob privado separado foi conectado a Preview e Production para os comprovantes;
- migrations de 26/08 aplicadas e verificadas em Preview e Production; nenhuma linha de usuário ou pagamento foi modificada pela criação das novas tabelas.

## Resultado

O candidato foi aprovado para o piloto dentro do escopo acima. Isso não equivale a certificação de segurança: MFA, RLS, retenção jurídica e pentest independente continuam sendo requisitos para ampliar o produto além do piloto.
