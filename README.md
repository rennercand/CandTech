# CandTech

Aplicação web para análise e organização financeira, construída com Next.js. A CandTech reúne calculadoras de investimentos, sistemas de amortização, formação de preço, organização de custos, importação de extratos bancários em PDF e histórico privado por conta.

**Produção:** [finance-app-indol-alpha.vercel.app](https://finance-app-indol-alpha.vercel.app/)

## Funcionalidades

- Cadastro e login com sessão individual.
- Central inicial com documentos recentes e modelos para novos trabalhos.
- Até 10 documentos manuais por conta; salvar novamente atualiza o documento aberto e somente “Novo documento” inicia outro.
- Dashboard financeiro por usuário.
- Cálculos de VPL, TIR, ROI e payback com data estimada de retorno.
- Fluxos de caixa com datas, entradas, saídas e detalhes interativos.
- Tabelas de amortização PRICE, SAF, SAA e SAC com memória de cálculo.
- Formação de preço unitário a partir de despesas, unidades e margem de lucro.
- Organização financeira com categorias e gráfico de distribuição de custos.
- Importação local de extratos bancários em PDF.
- Salvamento automático do workspace vinculado à conta.
- Rascunho automático no histórico quando a pessoa sai sem salvar manualmente.
- Exportação em CSV com BOM, separador e decimais compatíveis com Excel em pt-BR.
- Exportação XLSX com itens de estoque, múltiplos financiamentos por finalidade, memória de juros e resumo final de gastos.
- Tabela financeira preenchida anexada ao mesmo histórico do cálculo.
- Interface responsiva para computador e celular.
- Valores de entrada exibidos com sinal positivo e verde; saídas e gastos com sinal negativo e vermelho.
- Pré-nota de produto em PDF para conferência comercial, explicitamente sem validade fiscal.
- Cadastro diferenciado para pessoa física e empresa.
- Página de futura assinatura em `/assinar`, sem preços ou cobrança ativa.
- Perfil cadastral de cobrança sem antecipar CPF/CNPJ e sem armazenar cartão, senha ou conta bancária.
- Estoque com busca, filtros, ordenação, alertas e ajustes rápidos de quantidade.
- Geração de rascunhos editáveis de vendas e compras a partir dos lançamentos importados do extrato.

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19 e Next.js 16 App Router |
| API | Route Handlers do Next.js |
| Produção | Vercel |
| Banco em produção | PostgreSQL/Neon |
| Banco local | SQLite nativo do Node.js |
| Autenticação | JWT com `jose` e cookie HttpOnly |
| Senhas | `bcryptjs` |
| Leitura de PDF | PDF.js |

## Como os dados são protegidos

O banco inteiro não é transformado em hash. Hash é irreversível e, por isso, é adequado para senhas, mas não para cálculos e históricos que precisam ser exibidos novamente.

- As senhas são transformadas com `bcrypt`, salt automático e custo 12 antes de serem armazenadas. A senha original não é gravada.
- A sessão usa um JWT assinado, com duração de 8 horas, armazenado em cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção.
- Históricos e workspaces possuem `user_id`. As consultas usam o identificador obtido da sessão para impedir que uma conta leia ou altere registros de outra.
- Requisições que alteram dados validam `Origin`, `Sec-Fetch-Site` e o tipo `application/json` antes de acessar o banco.
- APIs possuem rate limit compartilhado no PostgreSQL/Neon; o IP é armazenado somente como hash e limites excedidos retornam `429`.
- O Next.js envia CSP, HSTS, bloqueio de iframe, `nosniff`, política de referência e restrições de permissões do navegador.
- Contas aceitam senha entre 8 e 128 caracteres; a interface recomenda frases com 15 ou mais caracteres para maior segurança.
- O extrato PDF é processado no navegador e não é enviado ao servidor pelo importador.
- `.env.local`, bancos locais, configurações da Vercel, logs e relatórios de segurança são ignorados pelo Git.
- Segredos de produção ficam nas Environment Variables criptografadas da Vercel.

> Segurança é um processo contínuo. O limitador atual é distribuído pelo banco; em volume muito alto, Redis/Upstash pode reduzir a carga adicionada ao PostgreSQL.

## Situação para uso empresarial

Os controles acima formam uma base de segurança, mas não representam certificação nem deixam o produto automaticamente pronto para empresas. Antes da comercialização, o projeto ainda deve receber:

- modelo multiempresa com `tenant_id`, organizações, papéis e permissões;
- MFA e, conforme o cliente, SSO/SAML;
- limitador distribuído, trilha de auditoria imutável e alertas de segurança;
- cálculos oficiais executados e validados no servidor, com versão da fórmula e testes de referência;
- políticas LGPD, retenção e exclusão de dados, recuperação de backup e resposta a incidentes;
- revisão independente, testes de invasão e monitoramento contínuo das dependências.

A TIR é exibida como `N/D` quando o fluxo não possui uma raiz única verificável no intervalo suportado. Isso evita transformar um fluxo ambíguo em uma taxa aparentemente precisa.

## Salvamento automático

Cada usuário possui um workspace próprio no banco. Após uma pequena pausa na edição, o site salva automaticamente:

- dados das calculadoras;
- fluxos e organização financeira;
- tabela financeira selecionada;
- despesas e parâmetros de formação de preço;
- filtros e nomes utilizados na organização.

Ao entrar novamente, o workspace e o documento ativo são restaurados. Salvar atualiza esse documento em vez de criar uma cópia. Somente a ação “Novo documento” limpa o vínculo atual; o servidor limita cada conta a 10 documentos manuais. Se a pessoa sair com uma revisão que não foi salva manualmente, o sistema cria ou atualiza um único item do tipo `rascunho-automatico`, que não entra nessa cota. Revisões já arquivadas não são duplicadas.

## Executar localmente

### Requisitos

- Node.js 22 ou superior;
- npm;
- PostgreSQL/Neon opcional. Sem `DATABASE_URL`, o projeto usa SQLite local.

### Instalação

```bash
git clone https://github.com/rennercand/finance-app.git
cd finance-app
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

`DATABASE_URL` é opcional no desenvolvimento local. Para gerar um segredo seguro, use um gerador criptográfico, como `openssl rand -base64 48`.

Inicie o projeto:

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run dev    # servidor de desenvolvimento
npm run build  # build otimizado de produção
npm run start  # executa o build de produção
```

## Estrutura do projeto

```text
app/
  api/auth/          cadastro, login e sessão
  api/history/       histórico, exclusão e CSV
  api/workspace/     restauração, autosave e rascunho automático
  advanced-tools.js  financiamento, preço e leitor de PDF
  page.js            dashboard, cálculos e organização financeira
lib/
  auth.js            criação e validação do JWT
  db.js              PostgreSQL/Neon e fallback SQLite
  finance-calculations.js
  request-security.js valida origem e formato das mutações
next.config.mjs       cabeçalhos de segurança do navegador
  statement-parser.js
public/
  pdf.worker.min.mjs
```

## Banco de dados

As tabelas são criadas automaticamente na primeira utilização:

- `users`: nome, e-mail e hash da senha;
- `histories`: cálculos, organizações e rascunhos salvos por usuário;
- `workspaces`: estado mais recente da interface, revisão e controle de arquivamento.
- `rate_limits`: contadores temporários por hash de origem e grupo de rota.
- `google_drive_connections`: refresh token cifrado e vinculado ao usuário.

### Como o banco atual funciona

- Na Vercel, o backend usa PostgreSQL Serverless do Neon por meio de `DATABASE_URL`.
- Somente Route Handlers e bibliotecas executadas no servidor acessam essa variável; ela não entra no JavaScript do navegador nem nos payloads da API.
- `lib/db.js` inicializa a conexão de forma tardia e reutiliza a mesma Promise durante a vida da instância serverless.
- As consultas usam parâmetros do driver Neon e os registros privados sempre incluem o `user_id` obtido da sessão.
- Em desenvolvimento local, quando `DATABASE_URL` não existe, o sistema usa `data/finsight.sqlite`. Esse arquivo é apenas um fallback local e não deve ser usado na Vercel.
- As credenciais de conexão de Production e Preview ficam como variáveis `Sensitive` na Vercel. Dados de usuários, extratos e payloads ficam no banco, nunca em variáveis de ambiente.

Desde 5 de agosto de 2026, os ambientes estão separados: Production usa a branch principal do Neon, Preview usa a branch `preview-test` criada somente com o schema, e Development não recebe credenciais PostgreSQL da Vercel. Assim, o desenvolvimento local cai no SQLite quando não houver uma `DATABASE_URL` local explícita. As duas URLs implantadas ficam como variáveis `Sensitive` e nunca entram no repositório.

## Google Drive

O menu de exportação diferencia download local e envio ao Google Drive. Cada usuário conecta a própria conta Google pelo OAuth 2.0 com o escopo restrito `drive.file`. O servidor troca e renova os tokens; refresh tokens são cifrados com AES-256-GCM antes de entrar no banco. Ao desconectar, a permissão é revogada no Google e removida da CandTech.

## Ideias planejadas

A evolução comercial — conciliação por regras, estoque, rastreamento, Reforma Tributária e split payment — está organizada em [ROADMAP-PRODUTO.md](./docs/ROADMAP-PRODUTO.md). A inteligência artificial foi retirada do escopo atual. O plano conceitual de proteção está em [ROADMAP-SEGURANCA.md](./docs/ROADMAP-SEGURANCA.md), enquanto os achados verificados no código ficam em [ROADMAP-CORRECOES-SEGURANCA.md](./docs/ROADMAP-CORRECOES-SEGURANCA.md). Esses documentos são planejamento: não indicam que as funções ou controles já foram implementados.

As pendências operacionais e externas anteriores à cobrança estão em [CHECKLIST-ANTES-DE-VENDER.md](./docs/CHECKLIST-ANTES-DE-VENDER.md).

O fluxo entre frontend, APIs, banco de dados, Vercel e Google Drive está documentado em [ARQUITETURA.md](./docs/ARQUITETURA.md).

As fórmulas, premissas, testes de referência e limitações estão registradas em [AUDITORIA-FINANCEIRA.md](./docs/AUDITORIA-FINANCEIRA.md).

As variáveis `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `DRIVE_TOKEN_ENCRYPTION_KEY` devem ficar somente no `.env.local` e nas variáveis sensíveis da Vercel, nunca no repositório.

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

## Licença

Distribuído sob a licença ISC definida em `package.json`.
