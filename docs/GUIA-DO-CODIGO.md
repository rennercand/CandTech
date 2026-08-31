# Guia do código da CandTech

Este documento é o ponto de entrada técnico para quem for manter, revisar ou treinar outra pessoa no projeto. Ele descreve responsabilidades, limites de segurança e o caminho das operações principais sem exigir a leitura imediata de todos os arquivos.

## Princípios do projeto

1. **Identidade vem da sessão:** IDs enviados pelo navegador nunca determinam sozinho o usuário ou a empresa que será acessada.
2. **Autorização ocorre no servidor:** cada rota privada autentica o JWT, recarrega a sessão persistida e resolve a organização e as permissões atuais.
3. **Cobrança é confirmada pelo administrador:** gerar ou copiar o Pix não libera o ERP. Somente um administrador autenticado pode aprovar o recebimento após conferência bancária.
4. **Segredos ficam no servidor:** chave Pix, Resend, Google, JWT e banco não podem usar o prefixo `NEXT_PUBLIC_` nem aparecer em respostas públicas da API.
5. **Importação tem prévia:** planilhas são interpretadas e validadas antes de alterar o saldo. SKU duplicado ou inválido produz erro, não atualização parcial silenciosa.
6. **Comentários explicam decisões:** comentários devem registrar o motivo de uma regra ou proteção. O código não precisa repetir em comentário aquilo que já diz claramente.

## Mapa de diretórios

| Caminho | Responsabilidade |
| --- | --- |
| `app/candtech-app.js` | Fluxo principal da interface: autenticação, aceite jurídico, assinatura e workspace |
| `app/client-manager.js` | Carteira de clientes, busca, status e atalhos seguros de contato |
| `app/task-kanban.js` | Quadro de tarefas com prazos, prioridade, cliente e etapas |
| `app/api/auth/` | Cadastro, login, sessão, confirmação de e-mail, recuperação de senha e MFA TOTP |
| `app/api/pix/` | Geração autenticada, consulta e envio de comprovante Pix |
| `app/api/admin/payments/` | Leitura administrativa privada do comprovante |
| `app/api/admin/staff/` | Concessão e revogação de acessos internos pelo administrador principal |
| `app/api/cron/` | Expiração periódica e entrega do backup por e-mail |
| `app/api/inventory/` | Operações e exportações do estoque relacional |
| `app/api/team/` | Cargos, membros e convites empresariais |
| `lib/auth.js` | JWT, cookie, sessão persistida e revogação |
| `lib/organization-access.js` | Resolução de organização, proprietário e permissões |
| `lib/billing-access.js` | Regra que decide se a assinatura bloqueia o acesso |
| `lib/pix.js` | Geração do código EMV Pix e leitura segura da configuração |
| `lib/pix-receipt.js` | Validação de nome, MIME, magic bytes, limite e SHA-256 |
| `lib/pix-receipt-storage.js` | Blob privado em produção e disco ignorado pelo Git no desenvolvimento |
| `lib/staff-db.js` | Persistência das permissões internas, sem manipular senha |
| `lib/admin-access.js` | Combina a raiz de confiança `ADMIN_EMAILS` com os privilégios persistidos |
| `lib/pix-db.js` | Solicitações, aprovação, rejeição e expiração dos pagamentos |
| `lib/account-backup.js` | Exportação ZIP limitada, sem senha, sessão ou token |
| `lib/inventory-import.js` | Leitura de CSV, TSV, TXT e XLSX e normalização das colunas |
| `lib/financial-import.js` | Leitura local de CSV, OFX/QFX e XLSX, prévia e fingerprint estável |
| `lib/db.js` | Persistência PostgreSQL/Neon e fallback SQLite local |
| `migrations/` | Alterações versionadas do banco PostgreSQL |
| `test/` | Testes de cálculo, isolamento, autenticação, cobrança e importação |

## Fluxo de autenticação

```text
Cadastro → confirmação de e-mail → login → cookie JWT HttpOnly
        → validação da sessão no banco → organização/permissões atuais → API privada
```

- A senha é armazenada somente como hash bcrypt.
- O JWT não basta sozinho: a sessão correspondente precisa existir, não estar revogada e estar dentro da expiração absoluta.
- A API recarrega dados atuais do usuário após validar o token.
- Convites só podem ser aceitos pela conta autenticada com o mesmo e-mail convidado.

## Isolamento contra IDOR

O navegador pode informar o UUID público de um documento, mas não escolhe seu proprietário. `getAccessibleHistory` combina o UUID com o `ownerUserId` resolvido pela sessão. Para estoque, equipe e exportações, o `tenant_id` também é derivado da organização autenticada. Trocar um ID na URL ou no JSON não muda esse escopo.

Ao criar uma rota nova:

1. chame a autenticação do servidor;
2. resolva a organização com `getOrganizationAccess` ou `requirePermission`;
3. use o proprietário/tenant retornado na consulta;
4. valide formato, tamanho e origem da requisição;
5. não retorne diferenças que permitam descobrir registros de outra empresa.

## Fluxo da assinatura por Pix

```text
Proprietário → POST /api/pix → código individual + chamado interno
Proprietário → upload privado → validação binária → payment_review
Administrador → abre comprovante protegido → confere o extrato → aprova ou rejeita
Banco local → getBillingAccess → liberação por 30 dias ou bloqueio
Rejeição/expiração → ZIP sem credenciais → Resend → e-mail verificado do proprietário
```

- `PIX_KEY` existe somente no servidor e é retornada dentro do código Pix apenas ao proprietário autenticado.
- `PIX_MONTHLY_AMOUNT_CENTS` representa R$ 60 mensais e `PIX_SETUP_AMOUNT_CENTS` os R$ 120 iniciais.
- uma solicitação pendente é reutilizada para impedir cobranças duplicadas por cliques repetidos.
- o upload não ativa a assinatura; somente `payment_review` pode ser aprovado, e cada cobrança mantém um único comprovante ativo.
- em produção, o navegador envia direto ao Blob com token curto para suportar o limite funcional de 5 MB; o callback assinado revalida usuário, pagamento e conteúdo antes de gravar os metadados.
- `CRON_SECRET` protege o processamento periódico de vencimentos e backups.
- `BILLING_ENFORCEMENT_ENABLED` permanece `false` até o fluxo completo ser homologado.

## Importação de estoque

O importador aceita `.csv`, `.tsv`, `.txt` e `.xlsx`. Ele procura o melhor cabeçalho nas primeiras 30 linhas e reconhece aliases como `Produto`, `Nome`, `Variação`, `SKU`, `Quantidade`, `Custo`, `Preço`, `Categoria`, `Lote` e `Validade`.

Regras importantes:

- `.xls` binário antigo não é aceito; deve ser salvo como `.xlsx` ou `.csv`;
- planilha sem quantidade pode cadastrar produtos com saldo inicial zero;
- entrada em SKU existente exige coluna de quantidade e valor maior que zero;
- valores brasileiros como `1.234,56` são normalizados antes da prévia;
- nenhuma linha é persistida antes da confirmação do usuário.

## Importação financeira

`lib/financial-import.js` lê `.csv`, `.tsv`, `.txt`, `.ofx`, `.qfx` e `.xlsx` no navegador. O parser reconhece Data, Valor ou o par Crédito/Débito, aceita decimal brasileiro, datas brasileiras e número serial do Excel. Em OFX, usa `FITID` quando disponível.

Antes da confirmação, a interface mostra novos, duplicados e linhas inválidas. A impressão digital SHA-256 combina a versão do importador, o formato e o identificador bancário estável; quando o arquivo não oferece ID, usa os campos normalizados e a ocorrência determinística. Cada confirmação recebe `importBatchId` e `importedAt`; desfazer remove todas as linhas desse lote. O índice único no banco é a última barreira contra reimportação concorrente.

## Navegação e relatório geral

A página autenticada abre em `home`, que representa a Visão geral. O `workspace` é uma área separada para documentos e modelos. A ordem operacional do menu é intencional: clientes e tarefas → pedidos → logística e estoque → movimentações → financiamentos → análises → formação de preço.

Clientes e tarefas pertencem ao workspace da organização e passam pelos filtros de `lib/team-permissions.js`. Um colaborador só recebe e grava essas chaves se o cargo possuir `clients` ou `tasks`. Os atalhos de WhatsApp e e-mail abrem o aplicativo escolhido pela pessoa; a CandTech não envia mensagens automaticamente nem entrega a lista de clientes a um provedor de marketing.

O relatório geral diferencia métricas que não significam a mesma coisa:

- vendas do mês: total de pedidos de venda não cancelados;
- receita recebida: entradas de caixa confirmadas no mês;
- lucro bruto estimado: vendas menos compras do mês, até existir custo por item vendido;
- lucro líquido operacional: entradas menos saídas realizadas no mês.

Esses indicadores apoiam gestão e não substituem demonstrativo contábil ou apuração fiscal.

## Movimento visual e fluxo de caixa

O arquivo `design-system/candtech-erp/MASTER.md` guarda a referência visual gerada com a habilidade UI/UX Pro Max. A implementação preserva a identidade clara e roxa já utilizada pela CandTech; recomendações genéricas que exigiriam trocar toda a interface por um tema escuro não são aplicadas automaticamente.

As animações usam principalmente `transform` e `opacity`, durações curtas e a curva `--ease-out`. A troca de módulo anima o contêiner `.view-stage`, enquanto os cartões de resumo recebem um pequeno atraso progressivo. A regra global `prefers-reduced-motion` reduz essas transições para pessoas sensíveis a movimento. Novos efeitos devem manter foco visível, não bloquear cliques e não animar propriedades que provoquem recálculo frequente do layout.

Na aba Movimentações existem duas leituras complementares:

- barras de entradas e saídas: mostram a magnitude de cada lançamento;
- saldo acumulado: começa em zero dentro do filtro selecionado e mostra como cada lançamento altera o caixa, além do maior saldo, menor saldo e saldo final.

O saldo acumulado não representa automaticamente o saldo bancário anterior ao período. Essa premissa aparece ao lado do gráfico para evitar uma interpretação contábil incorreta, e a tabela de lançamentos permanece como alternativa detalhada e acessível.

## Banco e migrations

Em produção, `DATABASE_URL` aponta para PostgreSQL/Neon. No desenvolvimento sem essa variável, o projeto usa SQLite. Mudanças estruturais destinadas à produção devem ganhar uma migration em `migrations/` e ser aplicadas, em ordem, antes do deploy. Somente o SQLite local cria tabelas automaticamente; o runtime Postgres não executa DDL nem reparos de dados.

## Como adicionar uma API privada

Use como checklist:

- autenticação obrigatória;
- permissão de área quando aplicável;
- tenant/proprietário resolvido no servidor;
- limite de corpo e validação do tipo de conteúdo;
- consultas parametrizadas;
- mensagem de erro sem dados pessoais ou segredos;
- teste de acesso cruzado e caso de sucesso;
- evento de auditoria quando a operação for sensível.

## Testes e validação

```bash
npm test
npm run build
```

O primeiro comando executa os testes nativos do Node. O segundo valida a compilação de produção do Next.js. Ambos devem passar antes de enviar `test` ou `main`.

## Padrão de comentários

Bom comentário:

```js
// Webhooks podem chegar fora de ordem; buscamos o estado atual antes de persistir.
```

Comentário desnecessário:

```js
// Soma um ao índice.
index += 1;
```

Prefira JSDoc em funções exportadas que representam fronteiras importantes. Comentários internos devem explicar riscos, compatibilidade ou decisões que não são óbvias apenas pelo nome da função.

## Histórico identificado de commits

Este catálogo cobre os commits funcionais existentes até `630c446`. O hash curto identifica de forma imutável a revisão; a explicação registra o efeito principal, inclusive quando o título original era genérico ou estava em inglês. Commits posteriores devem ser acrescentados aqui em revisões futuras, sem reescrever hashes já publicados.

### Fundação e persistência — 30 e 31 de julho de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `d3bba90` | 30/07 | `feat` inicial | Criou a primeira base funcional do FinSight/CandTech e reuniu os módulos financeiros iniciais. |
| `1818192` | 31/07 | `feat` persistência | Adicionou contas de usuário e persistência privada dos trabalhos financeiros. |
| `0a772a6` | 31/07 | `security` repositório | Passou a ignorar arquivos locais sensíveis e reduziu o risco de versionar credenciais. |
| `fcac214` | 31/07 | `docs` arquitetura | Documentou a arquitetura inicial, o banco e as medidas de segurança existentes. |
| `8cd185f` | 31/07 | `security` e cálculos | Reforçou validações de entrada, autenticação e consistência dos cálculos financeiros. |
| `41193bb` | 31/07 | `feat` histórico/exportação | Integração inicial entre documentos salvos, histórico e exportações financeiras. |
| `0cd9426` | 31/07 | `security` OAuth | Impediu que credenciais e tokens do Google OAuth fossem enviados ao Git. |
| `92f1c55` | 31/07 | `feat` Google Drive | Adicionou conexão e envio de exportações para o Google Drive. |
| `5d60c5f` | 31/07 | `security` senha | Ajustou a política mínima de senha e a validação do cadastro. |
| `f8697cd` | 31/07 | `fix` OAuth | Corrigiu o retorno do OAuth para retomar a exportação ao Drive. |
| `c56bf9e` | 31/07 | `feat` módulos salvos | Permitiu salvar e exportar mais módulos financeiros pelo histórico. |
| `ff77008` | 31/07 | `fix` interface Drive | Deixou mais clara a ação de envio direto ao Google Drive. |
| `6c9f0da` | 31/07 | `feat` XLSX | Adicionou planilhas Excel e envio desses arquivos ao Drive. |
| `4bef1ce` | 31/07 | `fix` downloads/OAuth | Corrigiu o fluxo OAuth e os downloads iniciados pelo histórico. |
| `25da084` | 31/07 | `fix` desacoplamento | Separou Drive e PDF de dependências do fluxo legado de exportação. |
| `40afed0` | 31/07 | `fix` PDF | Passou a gerar relatórios PDF para todas as abas suportadas. |
| `706e5d9` | 31/07 | `feat` edição financeira | Adicionou limpeza da organização financeira e exclusão individual de lançamentos. |

### Interface, auditoria financeira e operações — 1º de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `5dfc9f7` | 01/08 | `fix` usabilidade | Melhorou o tooltip e a leitura dos pontos no fluxo de caixa. |
| `a17b15f` | 01/08 | `feat` marca/interface | Atualizou a identidade visual da época e simplificou a operação do fluxo de caixa. |
| `f20881a` | 01/08 | `test/docs` cálculos | Auditou fórmulas financeiras e aprimorou a composição das exportações. |
| `4edeecb` | 01/08 | `fix` dashboard | Removeu um indicador repetido para evitar informação duplicada. |
| `1ddf329` | 01/08 | `feat` documentos/login | Criou a central de documentos e redesenhou a experiência de autenticação. |
| `b42d4f3` | 01/08 | `feat` animação | Adicionou a prévia animada do produto à tela de login. |
| `382ab26` | 01/08 | `feat` operações comerciais | Introduziu módulos de vendas, compras, produtos e rotinas empresariais. |
| `6ebc26b` | 01/08 | `feat` automação | Automatizou reflexos financeiros e de estoque gerados pelas operações comerciais. |
| `b3374c6` | 01/08 | `feat` monitoramento/exportação | Adicionou acompanhamento privado das operações e unificou exportações. |

### Planejamento e preparação empresarial — 3 e 6 de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `cd140df` | 03/08 | `docs` produto | Ampliou a roadmap de produto e os passos de evolução comercial. |
| `c5e31ee` | 03/08 | `docs` segurança | Criou a roadmap específica de segurança. |
| `9c2e93d` | 03/08 | `docs` navegação | Ligou as roadmaps de produto e segurança à documentação principal. |
| `7969e03` | 06/08 | `feat/security` preparação | Consolidou melhorias de produto e estoque e adicionou bases de segurança e cobrança futura. |
| `d2af21a` | 06/08 | `feat` responsividade/custos | Adaptou as principais telas ao celular e detalhou a composição de custos. |

### Equipes, cargos e painel operacional — 8 de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `76ea70e` | 08/08 | `feat` equipe | Criou organizações, membros e permissões empresariais. |
| `677b590` | 08/08 | `feat` cargos | Organizou cargos reutilizáveis e áreas de acesso por empresa. |
| `2fb3b59` | 08/08 | `feat` dashboard | Transformou a visão geral em painel operacional integrado ao workspace. |
| `9e3e3c7` | 08/08 | `feat` integração operacional | Ligou pedidos a movimentos de estoque e lançamentos financeiros. |
| `212dfce` | 08/08 | `security` consistência de estoque | Impediu alterações manuais incompatíveis quando o saldo é controlado por movimentos. |
| `0a2a51f` | 08/08 | `fix` convite empresarial | Corrigiu o ingresso por convite de uma conta empresarial já existente. |

### Segurança multiempresa, Analytics, estoque e SEO — 9 de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `a000dcd` | 09/08 | `security` IDOR | Protegeu APIs e documentos contra troca de IDs entre usuários/empresas e documentou o modelo. |
| `b28a29d` | 09/08 | `feat` Analytics | Adicionou GA4 condicionado ao consentimento e eventos de marketing minimizados. |
| `c12c350` | 09/08 | `docs` GA4 | Registrou o fluxo de configuração e uso do Google Analytics. |
| `fbc8795` | 09/08 | `fix` CSP | Liberou apenas os endpoints necessários do GA4 na política de segurança de conteúdo. |
| `b803438` | 09/08 | `feat` estoque relacional | Criou produtos, variações, lotes, movimentos e operação guiada por empresa. |
| `0000a19` | 09/08 | `feat` produtividade de estoque | Acelerou entradas e melhorou relatórios e ações frequentes do estoque. |
| `7fa05c5` | 09/08 | `feat` simplificação | Simplificou o financeiro e reorganizou o workspace para preservar praticidade. |
| `794fb71` | 09/08 | `feat` convites autenticados | Adicionou cargos personalizados e convites aceitos após autenticação do destinatário. |
| `53ca7e3` | 09/08 | `fix` SEO | Corrigiu headings, canonical, descrições e sinais apontados pela auditoria do Screaming Frog. |
| `da50289` | 09/08 | `feat/fix` convite e planilhas | Melhorou a jornada de convite e ampliou a leitura de catálogos com cabeçalho variável. |
| `d813110` | 09/08 | `chore` observabilidade | Reforçou logs, tratamento de falhas e confiabilidade operacional. |
| `65a9837` | 09/08 | `ci` runtime | Atualizou o runtime usado pelos workflows do GitHub Actions. |

### Vercel, e-mail e endurecimento do CI — 10 de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `ae7eb85` | 10/08 | `chore` Vercel | Impediu o versionamento da configuração local criada pela Vercel. |
| `7870f5d` | 10/08 | `feat` autenticação por e-mail | Adicionou confirmação de e-mail e recuperação segura de senha. |
| `b0d6d06` | 10/08 | `fix` links de preview | Corrigiu os links dos e-mails para respeitar o ambiente de preview. |
| `745c3a4` | 10/08 | `security` acesso verificado | Passou a exigir e-mail confirmado antes de liberar o ERP. |
| `e5c80d6` | 10/08 | `security` GitHub Actions | Desativou a persistência das credenciais do checkout no Git local do workflow. |
| `8cebc9d` | 10/08 | `chore` Strix temporário | Adicionou um arquivo temporário para comprovar domínio no serviço de pentest Strix. |

### Jurídico, Stripe, identidade e documentação — 11 de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `8c64fc4` | 11/08 | `chore` limpeza Strix | Removeu a verificação temporária da Strix depois do uso, sem deixar esse conteúdo no site. |
| `c8fc6dd` | 11/08 | `feat` base jurídica | Adicionou documentos legais próprios, versões e registro de aceite do usuário. |
| `3ac4ddc` | 11/08 | `feat` Stripe inicial | Criou Checkout, portal, webhook, tabelas de assinatura e documentação segura da integração. |
| `cc46e9d` | 11/08 | `feat/security` finalização comercial | Consolidou mensalidade e implantação, bloqueio controlado, testes de SQL injection, melhorias de convite/importação e a nova identidade visual. |
| `e5d34e3` | 11/08 | `docs` manutenção | Atualizou README, arquitetura e Stripe; criou este guia, o padrão de commits e comentários nas fronteiras críticas. |
| `243553e` | 11/08 | `docs` catálogo | Identificou e explicou no guia todos os commits publicados até então. |
| `6ea1094` | 11/08 | `feat` operação organizada | Separou Visão geral e Workspace, reordenou pedidos/logística/movimentações, criou Clientes e Kanban e ampliou o painel executivo com permissões e persistência. |
| `346020f` | 11/08 | `chore` artefatos locais | Impediu que capturas temporárias da verificação visual fossem enviadas ao repositório. |
| `c9991ef` | 11/08 | `feat` transição do menu | Fez o destaque roxo deslizar entre as abas no computador e no celular, respeitando a preferência de movimento reduzido. |
| `94c9013` | 11/08 | `docs` transição | Registrou no catálogo a implementação do indicador animado de navegação. |
| `7d4eb6c` | 11/08 | `feat/legal` copyright | Criou a política de propriedade intelectual e uso da marca, integrou-a aos Termos, rodapé, central jurídica e sitemap e passou a exigir a nova versão contratual. |
| `dfc90f0` | 11/08 | `docs` copyright | Registrou no catálogo a política de propriedade intelectual e uso da marca. |
| `3fc66c0` | 11/08 | `feat` mapa do sistema | Criou uma página pública com as áreas abertas, os módulos autenticados e os documentos jurídicos, mantendo APIs e rotas privadas fora do índice. |
| `8322932` | 11/08 | `docs` mapa do sistema | Registrou o mapa público do sistema e sua separação do sitemap técnico destinado aos buscadores. |
| `f4144ea` | 11/08 | `feat` movimento e caixa | Instalou e aplicou a referência UI/UX Pro Max, adicionou transições acessíveis e criou o gráfico de saldo acumulado com resumo do fluxo de caixa. |
| `6092e5e` | 11/08 | `docs` movimento e caixa | Registrou no README e no catálogo as animações acessíveis e a nova leitura do fluxo de caixa. |
| `f85b68b` | 11/08 | `feat` monitoramento e suporte | Criou a central administrativa protegida, captura segura de incidentes, chamados com resposta dentro do ERP, migration, testes e documentação operacional. |
| `79bd181` | 11/08 | `docs` monitoramento e suporte | Registrou no README e no catálogo a central administrativa e o fluxo de atendimento ao usuário. |
| `2a74b08` | 11/08 | `security` rota privada | Substituiu o endereço fixo da central por uma rota secreta entregue apenas ao administrador autenticado, com comparação segura e resposta 404 para tentativas inválidas. |
| `4a8a208` | 11/08 | `docs` rota privada | Registrou no catálogo a proteção adicional aplicada ao endereço da central de monitoramento. |
| `630c446` | 11/08 | `fix/ux` monitoramento e 404 | Fez a sessão identificar o administrador sem depender da assinatura ou das métricas, manteve o botão privado disponível e criou o 404 animado, responsivo e acessível. |
| `5edf169` | 11/08 | `docs` monitoramento e 404 | Registrou a correção de acesso à central e o comportamento visual da página não encontrada. |
| `2627a67` | 11/08 | `fix/security` e-mail único | Normalizou e-mails, arquivou duplicatas históricas com sessões revogadas, criou a garantia única no banco e passou a orientar o usuário a entrar ou recuperar a senha. |
| `7f3f78c` | 11/08 | `docs` e-mail único | Registrou no catálogo a proteção contra contas duplicadas por e-mail. |
| `8b8f27e` | 11/08 | `fix/ux` cadastro e menu | Exibiu o aviso de conta existente junto ao e-mail, com ações de recuperação, e manteve a conta e a saída visíveis na lateral enquanto os módulos rolam. |
| `0f9c9ce` | 11/08 | `docs` cadastro e menu | Registrou no catálogo a correção do aviso de conta existente e da navegação lateral. |

### Interface móvel e navegação pública — 12 de agosto de 2026

| Commit | Data | Identificação | O que mudou |
| --- | --- | --- | --- |
| `432d017` | 12/08 | `fix/ux` layout móvel | Centralizou os botões, transformou Recursos, Planos, Jurídico e Login em ações roxas com estados interativos e criou uma barra inferior segura e responsiva no celular. |
| `e67a270` | 12/08 | `docs` layout móvel | Registrou no catálogo a revisão de interface e navegação móvel. |
| `66a836a` | 12/08 | `chore` Analytics | Substituiu a propriedade pública do GA4 pela nova conta e manteve o carregamento condicionado ao consentimento analítico. |
| `0bbd708` | 12/08 | `feat` assinatura Pix | Removeu a integração ativa da Stripe, criou Pix manual com aprovação administrativa, expiração diária e backup idempotente por e-mail. |

### Como manter o catálogo

Para listar revisões ainda não documentadas:

```bash
git log 0bbd708..HEAD --date=short --pretty=format:"%h | %ad | %s"
```

Ao atualizar a tabela, descreva o resultado observável e não apenas copie a mensagem do commit. Não altere hashes ou explicações históricas para fazer o passado parecer diferente; correções devem ser registradas em uma nova linha.
