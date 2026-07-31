# FinSight

Aplicação de finanças pessoais em Next.js com autenticação por conta, cálculos de investimento, tabelas de amortização, formação de preço, importação local de extratos PDF e histórico persistente.

## Rodar localmente

1. Instale Node.js 22 ou superior (o SQLite nativo do Node é usado pelo projeto).
2. Copie `.env.example` para `.env.local`, defina um `JWT_SECRET` longo e configure `DATABASE_URL` quando quiser usar PostgreSQL/Neon.
3. Execute `npm install` e depois `npm run dev`.
4. Abra `http://localhost:3000` e crie a primeira conta.

## Onde manter

- `app/page.js`: interface, cálculos, filtros e tabelas de fluxo de caixa.
- `app/api/`: rotas de login, sessão, workspace automático, histórico e exportação CSV.
- `lib/auth.js`: JWT e cookie de sessão; configure o segredo antes de publicar.
- `lib/db.js`: camada de PostgreSQL/Neon em produção e SQLite no desenvolvimento local.

## Branches e publicação

- `main`: versão estável conectada à produção da Vercel.
- `test`: branch para desenvolver e validar atualizações; pushes nela devem gerar apenas preview.

Depois de validar uma atualização em `test`, faça merge em `main` para publicar em produção.

## Dados sensíveis

Arquivos `.env*`, banco local, configurações `.vercel`, logs e auditorias são ignorados pelo Git. O repositório contém somente `.env.example`, sem valores reais. Segredos de produção devem permanecer nas variáveis de ambiente da Vercel.

## Antes de publicar

Forneça `JWT_SECRET` e `DATABASE_URL` como variáveis de ambiente. Em uma instalação com alto volume, substitua o limitador em memória por Redis/Upstash.
