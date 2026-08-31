# CandTech

Aplicação web para análise e organização financeira, construída com Next.js. A CandTech reúne calculadoras de investimentos, sistemas de amortização, formação de preço, organização de custos, importação de extratos bancários em PDF e histórico privado por conta.

**Produção:** [www.candtech.com.br](https://www.candtech.com.br/)

**Estado atual:** ERP web funcional com autenticação por e-mail e MFA TOTP obrigatório para proprietários/equipe administrativa, workspace multiempresa, estoque relacional, equipe por cargos, documentos jurídicos, integração Google Drive e assinatura por Pix BR Code com QR Code, comprovante privado e conferência manual. O primeiro Pix soma R$ 60 da mensalidade e R$ 120 da implantação; depois de aprovado, as renovações são de R$ 60. A ativação obrigatória permanece controlada por `BILLING_ENFORCEMENT_ENABLED`.

## Funcionalidades

- Cadastro e login com sessão individual.
- Convites de equipe abrem uma jornada própria: mostram empresa, cargo, e-mail mascarado e áreas permitidas; após cadastro ou login, o colaborador entra diretamente no workspace empresarial.
- Início com relatório geral da conta: vendas do mês, receita recebida, caixa, lucro operacional, estoque, contas pendentes, clientes e tarefas.
- Workspace separado para documentos recentes e modelos, evitando misturar arquivos com a rotina diária do comércio.
- Menu ordenado pelo fluxo da operação: clientes e tarefas, pedidos, logística, movimentações, financiamentos, análises e formação de preço.
- Carteira de clientes com status e atalhos diretos para WhatsApp e e-mail.
- Quadro Kanban com tarefas, prioridade, prazo, cliente relacionado e etapas “A fazer”, “Em andamento” e “Concluído”.
- Página pública renderizada no servidor, com conteúdo institucional, headings semânticos, links internos e metadados canônicos para mecanismos de busca.
- Recuperação visual de falhas inesperadas, logs estruturados com remoção de dados sensíveis e CI no GitHub executando testes e build em `test` e `main`.
- E-mail de acesso normalizado e protegido por índice único no banco; tentativas repetidas recebem orientação para entrar ou recuperar a senha.
- Central privada com endereço não publicado, administrador principal em `ADMIN_EMAILS` e equipe interna com permissões independentes para monitoramento, suporte e cobrança.
- Página 404 própria, responsiva e acessível, com entrada animada da marca e movimento reduzido respeitado automaticamente.
- Aba Suporte com e-mail, telefone, WhatsApp, abertura de chamados e acompanhamento das respostas dentro do ERP.
- Até 10 documentos manuais por conta; salvar novamente atualiza o documento aberto e somente “Novo documento” inicia outro.
- Visão geral financeira integrada ao workspace de cada usuário.
- Cálculos de VPL, TIR, ROI e payback com data estimada de retorno.
- Fluxo de caixa com datas, entradas, saídas, saldo acumulado, maior/menor saldo e detalhes interativos.
- Tabelas de amortização PRICE, SAF, SAA e SAC com memória de cálculo.
- Formação de preço unitário a partir de despesas, unidades e margem de lucro.
- Organização financeira com categorias reutilizáveis criadas pelo usuário, seletores padronizados e gráfico de distribuição de custos.
- Importação local de extratos bancários em PDF.
- Salvamento automático do workspace vinculado à conta.
- Rascunho automático no histórico quando a pessoa sai sem salvar manualmente.
- Exportação em CSV com BOM, separador e decimais compatíveis com Excel em pt-BR.
- Exportação XLSX com itens de estoque, múltiplos financiamentos por finalidade, memória de juros e resumo final de gastos.
- Tabela financeira preenchida anexada ao mesmo histórico do cálculo.
- Interface responsiva para computador e celular.
- Transições curtas entre módulos, resposta visual em botões e gráficos animados com alternativa automática para quem prefere movimento reduzido.
- Valores de entrada exibidos com sinal positivo e verde; saídas e gastos com sinal negativo e vermelho.
- Pré-nota de produto em PDF para conferência comercial, explicitamente sem validade fiscal.
- Cadastro de conta pessoal ou empresarial; a cobrança utiliza apenas o nome e o e-mail já existentes na conta.
- Página de assinatura em `/assinar` com plano de R$ 60/mês e implantação única de R$ 120, Pix Copia e Cola individual, comprovante privado e confirmação exclusiva do administrador.
- Identificação de cobrança reduzida ao nome e e-mail já existentes na conta, sem duplicar tipo de pessoa, telefone, CPF/CNPJ, cartão, senha ou conta bancária.
- Política própria de copyright, propriedade intelectual e uso da marca para logotipo, ícone, imagens e telas, sem reivindicar conteúdo de clientes ou ativos licenciados de terceiros.
- Estoque relacional por empresa com produtos, variações, pedidos, entradas auditáveis e desfazimento.
- Cadastro ou recebimento em lote por CSV/TSV/TXT/XLSX, com detecção de cabeçalho após títulos, CSV UTF-8/Windows-1252, valores monetários brasileiros, prévia e conferência por SKU; catálogos sem quantidade entram com saldo zero apenas no cadastro.
- Visão do valor do estoque por categoria, alertas de mínimo/validade e relatório CSV/XLSX.
- Geração de rascunhos editáveis de vendas e compras a partir dos lançamentos importados do extrato.
- Cargos personalizados por empresa, com permissões reutilizáveis, convite individual por e-mail e aceite autenticado pelo destinatário.

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19 e Next.js 16 App Router |
| API | Route Handlers do Next.js |
| Produção | Vercel |
| Banco em produção | PostgreSQL/Neon |
| Banco local | SQLite nativo do Node.js |
| Arquivos privados | Vercel Blob privado; disco local somente em desenvolvimento |
| Autenticação | JWT com `jose` e cookie HttpOnly |
| Senhas | `bcryptjs` |
| Leitura de PDF | PDF.js |

## Visão de arquitetura

```mermaid
flowchart LR
  USER[Cliente ou colaborador] --> WEB[Next.js 16 na Vercel]
  STAFF[Equipe interna autorizada] --> WEB
  GITHUB[GitHub main e previews] -->|deploy| WEB
  WEB --> API[Route Handlers protegidos]
  API --> AUTH[Autenticação e autorização]
  API --> ERP[Workspace, estoque, pedidos e relatórios]
  API --> PIX[Pix BR Code e moderação]
  AUTH --> NEON[(PostgreSQL Neon)]
  ERP --> NEON
  PIX --> NEON
  PIX --> BLOB[(Vercel Blob privado)]
  API --> DRIVE[Google Drive OAuth]
  API --> EMAIL[Resend]
```

O fluxo completo, o mapa mental, os ambientes e a cobrança Pix estão em [ARQUITETURA.md](./docs/ARQUITETURA.md). O inventário objetivo do que ainda falta está em [ROADMAP-PENDENCIAS.md](./docs/ROADMAP-PENDENCIAS.md).

## Como os dados são protegidos

O banco inteiro não é transformado em hash. Hash é irreversível e, por isso, é adequado para senhas, mas não para cálculos e históricos que precisam ser exibidos novamente.

- As senhas são transformadas com `bcrypt`, salt automático e custo 12 antes de serem armazenadas. A senha original não é gravada.
- A sessão usa um JWT assinado, com duração absoluta de 8 horas, armazenado em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção. O identificador da sessão também é persistido para permitir revogação.
- Após validar o JWT e a sessão persistida, a API recarrega nome, e-mail e tipo de conta atuais do banco.
- Novos cadastros recebem confirmação de e-mail e só acessam as APIs do ERP após confirmar; contas anteriores são preservadas como verificadas. A recuperação usa token aleatório de uso único, guarda somente seu hash, expira em 30 minutos e revoga todas as sessões anteriores.
- Proprietários e equipe administrativa precisam ativar MFA TOTP. O segredo fica cifrado com uma chave exclusiva, o login usa desafio persistido de cinco minutos e uso único, e oito códigos de recuperação são mostrados uma única vez e guardados apenas como hashes.
- Históricos e workspaces combinam `user_id` com `organization_id`. Clientes e tarefas usam tabelas relacionais próprias, com `organization_id`, identificador público estável e vínculo tarefa→cliente. A organização e o proprietário são derivados da sessão, conferidos novamente na camada de banco e nunca aceitos do navegador; contas pessoais usam o escopo organizacional nulo.
- Documentos usam UUID público aleatório nas URLs; o ID sequencial do banco não é exposto. Toda busca combina o UUID com o proprietário derivado da sessão.
- Todas as APIs privadas exigem sessão. Cadastro, login, solicitação de recuperação, redefinição e confirmação de e-mail são públicos por necessidade do fluxo, com proteção de origem, limites de corpo e rate limit.
- Requisições que alteram dados validam `Origin`, `Sec-Fetch-Site` e o tipo `application/json` antes de acessar o banco.
- APIs possuem rate limit compartilhado no PostgreSQL/Neon; o IP é armazenado somente como hash e limites excedidos retornam `429`.
- O Next.js envia CSP, HSTS, bloqueio de iframe, `nosniff`, política de referência e restrições de permissões do navegador.
- Contas aceitam senha entre 8 e 128 caracteres; a interface recomenda frases com 15 ou mais caracteres para maior segurança.
- O extrato PDF é processado no navegador e não é enviado ao servidor pelo importador.
- Comprovantes Pix aceitam PDF/JPG/PNG/WEBP de até 5 MB, são validados por MIME e assinatura binária, armazenados de forma privada e só podem ser abertos por administradores autorizados.
- `.env.local`, bancos locais, configurações da Vercel, logs e relatórios de segurança são ignorados pelo Git.
- Segredos de produção ficam nas Environment Variables criptografadas da Vercel.

> Segurança é um processo contínuo. O limitador atual é distribuído pelo banco; em volume muito alto, Redis/Upstash pode reduzir a carga adicionada ao PostgreSQL.

## Situação para uso empresarial

Os controles acima formam uma base de segurança, mas não representam certificação nem deixam o produto automaticamente pronto para empresas. Antes da comercialização, o projeto ainda deve receber:

- concluir a normalização multiempresa com `tenant_id` em todas as entidades; organizações, proprietário, gerente, atendente e permissões por área já possuem uma primeira versão;
- SSO/SAML, somente quando houver demanda empresarial comprovada;
- limitador distribuído, trilha de auditoria imutável e alertas de segurança;
- cálculos oficiais executados e validados no servidor, com versão da fórmula e testes de referência;
- políticas LGPD, retenção e exclusão de dados, recuperação de backup e resposta a incidentes;
- revisão independente, testes de invasão e monitoramento contínuo das dependências.

A TIR é exibida como `N/D` quando o fluxo não possui uma raiz única verificável no intervalo suportado. Isso evita transformar um fluxo ambíguo em uma taxa aparentemente precisa.

## Salvamento automático

Cada conta pessoal ou organização possui um workspace isolado no banco. Clientes e tarefas são sincronizados em tabelas relacionais como fonte de verdade, mantendo o formato do workspace durante a transição sem quebrar a interface. Após uma pequena pausa na edição, o site salva automaticamente:

- dados das calculadoras;
- fluxos e organização financeira;
- tabela financeira selecionada;
- despesas e parâmetros de formação de preço;
- filtros, nomes e categorias financeiras criadas pelo usuário.
- carteira de clientes e quadro de tarefas com prazos.

Ao entrar novamente, o workspace e o documento ativo são restaurados. Salvar atualiza esse documento em vez de criar uma cópia. Somente a ação “Novo documento” limpa o vínculo atual; o servidor limita cada conta a 10 documentos manuais. Se a pessoa sair com uma revisão que não foi salva manualmente, o sistema cria ou atualiza um único item do tipo `rascunho-automatico`, que não entra nessa cota. Revisões já arquivadas não são duplicadas.

## Executar localmente

### Requisitos

- Node.js 22 ou superior;
- npm;
- PostgreSQL/Neon opcional. Sem `DATABASE_URL`, o projeto usa SQLite local.

### Instalação

```bash
git clone https://github.com/rennercand/CandTech.git
cd CandTech
npm install
```

Copie o arquivo de exemplo:

```bash
copy .env.example .env.local
```

Preencha `.env.local` sem enviar esse arquivo ao Git:

```env
JWT_SECRET=gere-um-segredo-longo-e-aleatorio
DATABASE_URL=postgresql://usuario:senha@host/banco
```

Para testar a cobrança por Pix, configure somente no servidor:

```env
PIX_KEY=sua-chave-pix
PIX_RECEIVER_NAME=NOME DO TITULAR
PIX_RECEIVER_CITY=MAIRINQUE
PIX_MONTHLY_AMOUNT_CENTS=6000
PIX_SETUP_AMOUNT_CENTS=12000
PIX_PAYMENT_TTL_HOURS=72
BLOB_READ_WRITE_TOKEN=
CRON_SECRET=gere-um-segredo-longo-e-aleatorio
BILLING_ENFORCEMENT_ENABLED=false
```

`PIX_KEY` deve conter a chave cadastrada no DICT — e-mail, telefone, CPF/CNPJ ou chave aleatória EVP. O servidor remove aspas, espaços invisíveis e formatação comum; e-mail é normalizado em minúsculas, telefone vira `+55...` e CPF/CNPJ ficam somente com dígitos. Ela e `BLOB_READ_WRITE_TOKEN` não usam `NEXT_PUBLIC_`. O servidor monta e valida o BR Code, incluindo GUI em `26.00`, chave DICT em `26.01`, TXID em `62.05` e CRC16 em `63`; somente então entrega o Copia e Cola ao proprietário autenticado. Conecte ao projeto um Vercel Blob com acesso **Private**; o navegador recebe apenas uma autorização curta e limitada a 5 MB, nunca o token permanente. Ative `BILLING_ENFORCEMENT_ENABLED=true` apenas depois de aplicar as migrations, testar geração, decodificação EMV, envio/substituição do comprovante, visualização administrativa, aprovação, rejeição e expiração.

Para a atualização de 26/08, carregue a `DATABASE_URL` do ambiente desejado e execute `npm run migrate:2026-08-26`. O executor aceita somente as migrations versionadas de comprovantes e equipe, usa transações e confirma as duas tabelas antes de concluir.

As atualizações de segurança de 29/08 possuem executores independentes: `npm run migrate:2026-08-29:audit`, `npm run migrate:2026-08-29:oauth` e `npm run migrate:2026-08-29:mfa`. A migration MFA deve ser aplicada antes de publicar o código que consulta `mfa_verified_at`. A base de idempotência e outbox usa `npm run migrate:2026-08-30:idempotency`; ela foi aplicada e verificada nas branches `preview-test` e `main` do Neon em 30/08/2026.

`DATABASE_URL` é opcional no desenvolvimento local. Para gerar um segredo seguro, use um gerador criptográfico, como `openssl rand -base64 48`.

Para entregar convites de colaboradores diretamente por e-mail, verifique o domínio remetente no Resend e configure somente no servidor:

```env
RESEND_API_KEY=re_...
TEAM_INVITE_FROM="CandTech <convites@candtech.com.br>"
PUBLIC_APP_URL=https://candtech.com.br
```

`TEAM_INVITE_FROM` também é reutilizado para confirmação e recuperação. Se quiser separar os remetentes, configure `AUTH_EMAIL_FROM`. Sem Resend, o convite continua copiável, mas confirmação e recuperação por e-mail não podem ser entregues. O aceite de convite sempre exige autenticação com o mesmo e-mail que foi convidado.

Inicie o projeto:

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run dev    # servidor de desenvolvimento
npm run build  # build otimizado de produção
npm test       # testes automatizados
npm run start  # executa o build de produção
```

## Estrutura do projeto

```text
app/
  api/auth/          cadastro, login e sessão
  api/history/       histórico, exclusão e CSV
  api/workspace/     restauração, autosave e rascunho automático
  api/inventory/     estoque relacional, entradas, pedidos, relatórios e desfazimento
  api/pix/           cobrança Pix e upload autenticado de comprovante
  api/admin/payments/ leitura privada de comprovantes pelo administrador
  api/support/       chamados privados do usuário
  central/[accessKey] rota privada da central administrativa
  admin/monitoramento/ componentes de incidentes, suporte e cobrança
  assinar/           plano, QR Code Pix e comprovante opcional
  advanced-tools.js  financiamento, preço e leitor de PDF
  client-manager.js  carteira de clientes e atalhos de contato
  inventory-operations.js operação guiada e treinamento de estoque
  task-kanban.js      quadro de tarefas, prioridades e prazos
  page.js            dashboard, cálculos e organização financeira
lib/
  auth.js            criação e validação do JWT
  db.js              PostgreSQL/Neon e fallback SQLite
  inventory-db.js    produtos, variações e movimentos transacionais
  inventory-import.js leitura local de CSV/TSV/TXT/XLSX
  inventory-report.js relatório CSV/XLSX reimportável do estoque
  finance-calculations.js
  request-security.js valida origem e formato das mutações
  pix.js             gera, decodifica e valida o BR Code/EMV do Pix
  pix-db.js          solicitações, valores inicial/renovação e revisão
  pix-receipt.js     valida nome, tipo, assinatura e hash do comprovante
  pix-receipt-storage.js armazenamento privado no Blob ou disco local
  statement-parser.js importação local de extratos PDF
public/
  pdf.worker.min.mjs
next.config.mjs       cabeçalhos de segurança do navegador
```

## Banco de dados

No SQLite local, as tabelas são criadas automaticamente. No PostgreSQL/Neon,
aplique os arquivos de `migrations/` em ordem antes do deploy; as APIs nunca
executam DDL durante uma requisição:

- `users`: nome, e-mail e hash da senha;
- `histories`: cálculos, organizações e rascunhos salvos por usuário;
- `workspaces`: estado mais recente da interface, revisão e controle de arquivamento.
- `customers` / `operational_tasks`: carteira e tarefas relacionais isoladas por organização, incluindo o vínculo opcional da tarefa ao cliente.
- `rate_limits`: contadores temporários por hash de origem e grupo de rota.
- `google_drive_connections`: refresh token cifrado e vinculado ao usuário.
- `inventory_products` e `inventory_variants`: catálogo e saldo por SKU/empresa;
- `inventory_batches` e `inventory_movements`: livro auditável de entradas, vendas, compras e reversões;
- `inventory_orders` e `inventory_order_items`: pedidos com vários produtos.
- `monitoring_events`: resumos técnicos sem segredos, agrupados por tipo de falha;
- `support_tickets`: mensagens do suporte vinculadas ao usuário e respostas administrativas.
- `staff_access`: módulos administrativos concedidos a contas verificadas, sem guardar ou criar senhas;
- `billing_profiles`: estado da assinatura e `setup_paid_at`, que impede cobrar novamente a implantação;
- `pix_payment_requests`: cobranças Pix e estado da revisão manual;
- `pix_payment_receipts`: metadados e hash dos comprovantes; o conteúdo fica no armazenamento privado.
- `audit_events`: trilha append-only com autor, conta afetada, organização, origem, versão, objeto e antes/depois minimizado.
- `user_mfa`, `mfa_login_challenges` e `mfa_recovery_codes`: segredo TOTP cifrado, desafios expirados/consumíveis e recuperação de uso único.

### Como o banco atual funciona

- Na Vercel, o backend usa PostgreSQL Serverless do Neon por meio de `DATABASE_URL`.
- Somente Route Handlers e bibliotecas executadas no servidor acessam essa variável; ela não entra no JavaScript do navegador nem nos payloads da API.
- `lib/db.js` inicializa a conexão de forma tardia e reutiliza a mesma Promise durante a vida da instância serverless.
- no Neon, `CREATE`, `ALTER`, índices e reparos ficam exclusivamente nas migrations versionadas, evitando concorrência entre cold starts;
- As consultas usam parâmetros do driver Neon e os registros privados sempre incluem o `user_id` obtido da sessão.
- Em desenvolvimento local, quando `DATABASE_URL` não existe, o sistema usa `data/finsight.sqlite`. Esse arquivo é apenas um fallback local e não deve ser usado na Vercel.
- As credenciais de conexão de Production e Preview ficam como variáveis `Sensitive` na Vercel. Dados de usuários, extratos e payloads ficam no banco, nunca em variáveis de ambiente.

Depois de aplicar `migrations/20260829_audit_events_v2.sql` com a credencial administrativa, valide a credencial usada pelo aplicativo com `npm run security:check-db-role`. O comando falha se detectar superusuário, criação de banco/papel/schema ou propriedade de objetos públicos. Ele não imprime a URL de conexão.

O CI executa testes, build, `npm audit`, CodeQL e Gitleaks. O Dependabot acompanha semanalmente pacotes npm e mensalmente as GitHub Actions. A política operacional está em [BACKUP-E-RESTAURACAO.md](./docs/BACKUP-E-RESTAURACAO.md) e [PLANO-RESPOSTA-INCIDENTES.md](./docs/PLANO-RESPOSTA-INCIDENTES.md).

Desde 5 de agosto de 2026, os ambientes estão separados: Production usa a branch principal do Neon, Preview usa a branch `preview-test` criada somente com o schema, e Development não recebe credenciais PostgreSQL da Vercel. Assim, o desenvolvimento local cai no SQLite quando não houver uma `DATABASE_URL` local explícita. As duas URLs implantadas ficam como variáveis `Sensitive` e nunca entram no repositório.

## Google Drive

O menu de exportação diferencia download local e envio ao Google Drive, inclusive no relatório do estoque. Cada usuário conecta a própria conta Google pelo OAuth 2.0 com o escopo restrito `drive.file`. A autorização usa PKCE S256 e uma transação persistida, vinculada à sessão, com nonce expirável e consumível uma única vez. O servidor troca e renova os tokens; refresh tokens e verificadores PKCE temporários são cifrados com AES-256-GCM antes de entrar no banco. Ao desconectar, a permissão é revogada no Google e removida da CandTech. A rota de relatório do estoque não recebe ID de empresa: o `tenant_id` é sempre derivado da sessão JWT e das permissões atuais.

## Analytics, consentimento e SEO

- `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` ativa o GA4 somente depois do consentimento explícito para cookies analíticos;
- recusar não bloqueia nenhuma função da CandTech, e a preferência pode ser alterada pelo botão “Cookies”;
- eventos de marketing usam uma lista fechada de nomes e parâmetros e não aceitam e-mail, nome, documentos ou valores financeiros;
- o domínio canônico, sitemap e robots usam `https://www.candtech.com.br`, evitando que previews concorram com a produção;
- `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL` publica o canal de privacidade quando a empresa responsável o definir;
- `/privacidade` descreve a configuração técnica atual, mas ainda precisa dos dados da empresa responsável e revisão jurídica antes da comercialização.

## Ideias planejadas

A evolução comercial — conciliação por regras, estoque, rastreamento, Reforma Tributária e split payment — está organizada em [ROADMAP-PRODUTO.md](./docs/ROADMAP-PRODUTO.md). O recorte verificado entre o que já existe, o que é parcial e o que falta está em [ROADMAP-PENDENCIAS.md](./docs/ROADMAP-PENDENCIAS.md). A inteligência artificial foi retirada do escopo atual. O plano conceitual de proteção está em [ROADMAP-SEGURANCA.md](./docs/ROADMAP-SEGURANCA.md), enquanto os achados verificados no código ficam em [ROADMAP-CORRECOES-SEGURANCA.md](./docs/ROADMAP-CORRECOES-SEGURANCA.md). Esses documentos são planejamento: não indicam que as funções ou controles já foram implementados.

As pendências operacionais e externas anteriores à cobrança estão em [CHECKLIST-ANTES-DE-VENDER.md](./docs/CHECKLIST-ANTES-DE-VENDER.md).

A rotina de capacitação para proprietários e funcionários está em [GUIA-OPERACAO-ESTOQUE.md](./docs/GUIA-OPERACAO-ESTOQUE.md).

O fluxo entre frontend, APIs, banco de dados, Vercel e Google Drive está documentado em [ARQUITETURA.md](./docs/ARQUITETURA.md).

O que foi implementado e os achados corrigidos no fluxo de comprovante estão em [RELATORIO-IMPLEMENTACAO-PIX-2026-08-26.md](./docs/RELATORIO-IMPLEMENTACAO-PIX-2026-08-26.md).

Para entender responsabilidades dos arquivos, autenticação, IDOR, Pix, planilhas e critérios de comentários, leia [GUIA-DO-CODIGO.md](./docs/GUIA-DO-CODIGO.md). A operação da assinatura está em [PIX-MANUAL.md](./docs/PIX-MANUAL.md) e as proteções do banco em [SEGURANCA-DO-BANCO.md](./docs/SEGURANCA-DO-BANCO.md). O público do piloto e os limites comerciais estão em [ICP-CANDTECH.md](./docs/ICP-CANDTECH.md) e [ESCOPO-PILOTO.md](./docs/ESCOPO-PILOTO.md).

O padrão de branches, mensagens de commit e checklist de publicação está em [CONTRIBUINDO.md](./docs/CONTRIBUINDO.md).

O uso, a segurança e a operação da central privada estão em [MONITORAMENTO-E-SUPORTE.md](./docs/MONITORAMENTO-E-SUPORTE.md). O passo a passo para criar logins internos e conceder acessos está em [ACESSO-ADMINISTRATIVO.md](./docs/ACESSO-ADMINISTRATIVO.md).

As fórmulas, premissas, testes de referência e limitações estão registradas em [AUDITORIA-FINANCEIRA.md](./docs/AUDITORIA-FINANCEIRA.md).

As variáveis `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_ENCRYPTION_KEY` e `MFA_ENCRYPTION_KEY` devem ficar somente no `.env.local` e nas variáveis sensíveis da Vercel, nunca no repositório. As duas chaves de criptografia devem ser independentes e conter 32 bytes aleatórios em Base64.

Em produção, configure `DATABASE_URL` e `JWT_SECRET` nas configurações da Vercel. Não coloque valores reais em `.env.example`.

## Branches e deploy

- `main`: versão estável e branch de produção conectada à Vercel.
- `test`: desenvolvimento e validação de atualizações em preview.

Fluxo recomendado:

1. Trabalhe na branch `test`.
2. Faça o build e valide as funcionalidades.
3. Envie `test` para gerar um preview.
4. Depois da aprovação, faça merge em `main`.
5. O push na `main` publica automaticamente na Vercel.

## Privacidade do repositório público

O repositório contém apenas `.env.example` com campos vazios. Nunca versione:

- `.env.local` ou qualquer `.env.*.local`;
- URLs ou senhas do banco;
- tokens da Vercel ou GitHub;
- arquivos SQLite da pasta `data`;
- extratos bancários reais;
- logs que possam conter dados pessoais.

A auditoria de histórico e código de 29/08/2026 está registrada em [AUDITORIA-SEGREDOS-2026-08-29.md](./docs/AUDITORIA-SEGREDOS-2026-08-29.md). Ela não encontrou chave ou token versionado, mas confirma que o e-mail do autor dos commits e os contatos jurídicos intencionalmente publicados fazem parte da superfície pública do repositório.

## Licença

Distribuído sob a licença ISC definida em `package.json`.
