# Guia do código da CandTech

Este documento é o ponto de entrada técnico para quem for manter, revisar ou treinar outra pessoa no projeto. Ele descreve responsabilidades, limites de segurança e o caminho das operações principais sem exigir a leitura imediata de todos os arquivos.

## Princípios do projeto

1. **Identidade vem da sessão:** IDs enviados pelo navegador nunca determinam sozinho o usuário ou a empresa que será acessada.
2. **Autorização ocorre no servidor:** cada rota privada autentica o JWT, recarrega a sessão persistida e resolve a organização e as permissões atuais.
3. **Cobrança é confirmada por webhook:** uma página de sucesso da Stripe não libera o ERP. O servidor só considera o estado persistido após validar a assinatura do webhook.
4. **Segredos ficam no servidor:** chaves Stripe, Resend, Google, JWT e banco não podem usar o prefixo `NEXT_PUBLIC_` nem aparecer em respostas da API.
5. **Importação tem prévia:** planilhas são interpretadas e validadas antes de alterar o saldo. SKU duplicado ou inválido produz erro, não atualização parcial silenciosa.
6. **Comentários explicam decisões:** comentários devem registrar o motivo de uma regra ou proteção. O código não precisa repetir em comentário aquilo que já diz claramente.

## Mapa de diretórios

| Caminho | Responsabilidade |
| --- | --- |
| `app/candtech-app.js` | Fluxo principal da interface: autenticação, aceite jurídico, assinatura e workspace |
| `app/api/auth/` | Cadastro, login, sessão, confirmação de e-mail e recuperação de senha |
| `app/api/stripe/` | Criação do Checkout, portal do cliente e recepção de webhooks |
| `app/api/inventory/` | Operações e exportações do estoque relacional |
| `app/api/team/` | Cargos, membros e convites empresariais |
| `lib/auth.js` | JWT, cookie, sessão persistida e revogação |
| `lib/organization-access.js` | Resolução de organização, proprietário e permissões |
| `lib/billing-access.js` | Regra que decide se a assinatura bloqueia o acesso |
| `lib/stripe.js` | Cliente Stripe e validação de variáveis de ambiente |
| `lib/stripe-subscription.js` | Normalização segura de objetos e estados da Stripe |
| `lib/inventory-import.js` | Leitura de CSV, TSV, TXT e XLSX e normalização das colunas |
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

## Fluxo da assinatura Stripe

```text
Proprietário → POST /api/stripe/checkout → Checkout hospedado pela Stripe
Stripe → webhook assinado → consulta do estado mais recente da assinatura
       → banco local → getBillingAccess → liberação ou bloqueio do ERP
```

- `STRIPE_SECRET_KEY` é exclusiva do servidor.
- `STRIPE_PRICE_ID` representa R$ 60 mensais.
- `STRIPE_SETUP_PRICE_ID` representa R$ 120 cobrados uma vez no primeiro Checkout.
- `STRIPE_WEBHOOK_SECRET` valida que o evento veio da Stripe.
- `BILLING_ENFORCEMENT_ENABLED` funciona como chave de ativação controlada. Enquanto não for `true`, a integração pode ser testada sem bloquear clientes existentes.
- Eventos são deduplicados pelo ID da Stripe.
- Como webhooks podem chegar fora de ordem, o sistema consulta a assinatura atual antes de gravar o estado.

## Importação de estoque

O importador aceita `.csv`, `.tsv`, `.txt` e `.xlsx`. Ele procura o melhor cabeçalho nas primeiras 30 linhas e reconhece aliases como `Produto`, `Nome`, `Variação`, `SKU`, `Quantidade`, `Custo`, `Preço`, `Categoria`, `Lote` e `Validade`.

Regras importantes:

- `.xls` binário antigo não é aceito; deve ser salvo como `.xlsx` ou `.csv`;
- planilha sem quantidade pode cadastrar produtos com saldo inicial zero;
- entrada em SKU existente exige coluna de quantidade e valor maior que zero;
- valores brasileiros como `1.234,56` são normalizados antes da prévia;
- nenhuma linha é persistida antes da confirmação do usuário.

## Banco e migrations

Em produção, `DATABASE_URL` aponta para PostgreSQL/Neon. No desenvolvimento sem essa variável, o projeto usa SQLite. Mudanças estruturais destinadas à produção devem ganhar uma migration em `migrations/`; inicializações automáticas existem para compatibilidade, mas não substituem o histórico versionado.

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
