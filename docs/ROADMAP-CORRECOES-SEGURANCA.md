# Roadmap de correções de segurança verificadas — CandTech

Data da revisão inicial: 2026-08-05. Última consolidação documental: 2026-08-29.

As pendências atuais reunidas por prioridade estão em [ROADMAP-PENDENCIAS.md](./ROADMAP-PENDENCIAS.md). A revisão de segredos em todos os refs públicos está em [AUDITORIA-SEGREDOS-2026-08-29.md](./AUDITORIA-SEGREDOS-2026-08-29.md).

## Escopo e limites

Esta revisão analisou o código das branches `main` e `test`, rotas de API, autenticação, sessão, banco, Google Drive, exportações, cabeçalhos HTTP, dependências e configuração visível da Vercel. Também foram feitas requisições pequenas e não destrutivas para confirmar proteção de origem, tipo de conteúdo e autenticação.

Não foi executado pentest invasivo, teste de carga, tentativa de quebra de senha, exploração contra usuários, leitura de segredos locais nem alteração do firewall de produção. Portanto, este documento registra achados verificáveis e riscos de configuração; não é certificado de segurança.

### Controles confirmados

- `npm audit` encontrou e corrigiu em 9 de agosto de 2026 o alerta de severidade alta em `nanoid < 3.3.17`, dependência transitiva; a verificação final retornou zero vulnerabilidades conhecidas;
- senhas usam `bcrypt` com custo 12;
- cookies de sessão são `HttpOnly`, `Secure` em produção e `SameSite=Lax`;
- JWT aceita explicitamente apenas `HS256` e expira em oito horas;
- consultas de workspace, histórico, exportações e Drive usam o `user_id` da sessão;
- todas as APIs privadas exigem sessão JWT; apenas cadastro e login permanecem públicos por necessidade do fluxo de autenticação;
- atributos atuais da conta são recarregados do banco após a validação da sessão, em vez de confiar em nome, e-mail ou tipo de conta antigos no JWT;
- documentos expostos em URLs usam UUID público aleatório; o ID sequencial interno permanece restrito ao banco;
- testes automatizados e ensaio HTTP com duas empresas confirmaram `401` sem sessão e `404` para leitura ou exclusão cruzada por UUID adulterado;
- SQL usa parâmetros, sem concatenação direta de entrada do usuário;
- refresh tokens do Google Drive são cifrados com AES-256-GCM;
- mutações rejeitam origem cruzada e tipos de conteúdo inesperados;
- a produção respondeu `403` para mutação cross-origin, `415` para tipo inválido e `401` para histórico sem sessão;
- HSTS, bloqueio de iframe, `nosniff`, Referrer Policy e CSP estão ativos;
- a Vercel fornece mitigação DDoS automática da plataforma.

## Classificação

- **Crítica:** exploração pode comprometer amplamente dados, contas ou infraestrutura e deve interromper publicação.
- **Alta:** risco relevante de indisponibilidade, acesso indevido ou exposição; corrigir antes de vender para empresas.
- **Média:** exige condições adicionais, reduz defesa em profundidade ou aumenta impacto de outro ataque.
- **Baixa:** endurecimento e consistência operacional.

Nenhuma vulnerabilidade crítica explorável foi confirmada nesta revisão. Há riscos altos que impedem classificar o sistema como pronto para uso empresarial.

## Progresso local em 6 de agosto de 2026

As mudanças abaixo foram implementadas e testadas localmente, mas só contam como efetivas em produção depois de revisão, commit, deploy e verificação no ambiente publicado:

- **SEC-01 — implementada no código:** `.vercelignore` agora exclui a pasta de segredos, padrões de credenciais, relatórios locais e ambientes;
- **SEC-02 — implementada nas APIs próprias:** leitor JSON por streaming limita bytes, profundidade, quantidade de nós e tamanho de texto antes de bcrypt, banco, workspace, histórico ou PDF;
- **SEC-04 — implementada no código:** novas sessões possuem identificador persistido, expiração absoluta e revogação no logout; `/api/auth/me` não renova mais o prazo indefinidamente;
- **SEC-06 — parcialmente implementada:** o retorno do Google Drive agora precisa corresponder ao usuário e à sessão iniciadora, e há suporte a segredo OAuth separado; ainda faltam nonce consumível persistido e PKCE;
- **SEC-07 — implementada no código:** login usa comparação bcrypt fictícia para conta inexistente, cadastro possui resposta neutra e os limites foram separados por IP e identidade normalizada;
- **SEC-08 — implementada no código:** as exportações personalizadas neutralizam prefixos perigosos antes de abrir no Excel;
- **SEC-15 — parcialmente implementada:** eventos de criação de conta, login, logout e alteração do perfil de cobrança são registrados; ainda falta cobrir operações financeiras, exportações e permissões.

## Progresso local em 9 de agosto de 2026

- **SEC-04 — endurecida:** a sessão persistida continua sendo a fonte da identidade e os atributos atuais do usuário são consultados no banco a cada validação;
- **SEC-14 — parcialmente endurecida:** a consulta e o aceite de convite exigem sessão, e os detalhes do convite só são devolvidos quando o e-mail atual da conta corresponde ao destinatário; verificação de e-mail, recuperação e MFA continuam pendentes;
- **SEC-16 — parcialmente implementada:** a suíte agora cobre duas empresas, UUID público, tentativa de leitura, sobrescrita, exclusão e administração cruzadas, além de falhar quando uma nova API privada não declara validação de sessão;
- **IDOR de documentos — mitigado no código:** URLs deixaram de expor IDs sequenciais, mas o controle principal continua sendo a consulta com UUID público e proprietário derivado da sessão;
- **Dependências — corrigidas:** `npm audit fix` atualizou a dependência transitiva vulnerável e a auditoria final retornou zero achados;
- **Validação:** 26 testes e o build de produção passaram; o ensaio HTTP retornou `401` sem JWT, `404` para UUID de outra empresa, `404` para o antigo ID numérico e `200` apenas para o proprietário correto.

Essas mudanças ainda precisam passar por preview da branch `test` e verificação no domínio publicado antes de serem consideradas efetivas em produção.

Continuam dependendo de configuração ou validação externa: WAF na borda, rotação de credenciais potencialmente antigas, confirmação de backup/restauração, `OAUTH_STATE_SECRET` em produção, CSP sem `unsafe-inline`, e-mail verificado, MFA, pentest e monitoramento independente.

## P0 — Correções imediatas

### SEC-01 — Possível envio de credenciais locais em deploy pela CLI

- **Severidade:** alta.
- **Evidência:** existe a pasta local `finsight-secrets/`, protegida pelo `.gitignore`, mas a `.vercelignore` não contém essa pasta nem os padrões `client_secret*.json` e `credentials*.json`.
- **Risco:** quando um deploy é feito diretamente pela CLI, arquivos ignorados apenas pelo Git podem entrar no contexto enviado ao provedor de build, dependendo das regras efetivamente aplicadas pelo empacotador. Eles não deveriam fazer parte do projeto de deploy em nenhuma hipótese.
- **Correção:** incluir explicitamente na `.vercelignore` a pasta e todos os padrões de credenciais; manter segredos fora da raiz do projeto; inspecionar a lista de arquivos antes do próximo deploy CLI; rotacionar qualquer credencial que tenha sido enviada anteriormente.
- **Aceite:** nenhum arquivo de segredo aparece no pacote de deploy ou build; deploy continua funcionando apenas com Environment Variables.

### SEC-02 — Corpo HTTP interpretado antes de limite confiável

- **Severidade:** alta.
- **Evidência:** login, cadastro e workspace chamam `request.json()` sem limite prévio. Histórico e PDF conferem `Content-Length`, mas o cabeçalho pode estar ausente ou não representar um limite aplicado por streaming.
- **Risco:** payload grande ou profundamente aninhado consome memória e CPU antes da validação, podendo elevar custos ou causar indisponibilidade.
- **Correção:** criar leitor JSON limitado por bytes; rejeitar acima de 8 KB em login/cadastro e acima do limite funcional nas demais rotas; limitar profundidade, quantidade de registros e tamanho por campo; aplicar timeout.
- **Aceite:** testes com corpo excessivo retornam `413` antes de bcrypt, serialização e banco, inclusive sem `Content-Length`.

### SEC-03 — Rate limit depende do PostgreSQL e não existe WAF personalizado

- **Severidade:** alta.
- **Evidência:** `rate-limit.js` grava cada tentativa em `rate_limits`; a consulta da Vercel retornou lista vazia de regras customizadas de firewall.
- **Risco:** todo abuso ainda atinge função e Neon. Ataques distribuídos podem contornar o limite por IP e aumentar custo justamente no componente usado para defesa.
- **Correção:** criar regras WAF inicialmente em modo `log`; aplicar limite de borda separado para login, cadastro, PDF, Drive e mutações; migrar contadores da aplicação para Redis/Upstash ou equivalente; combinar IP, conta e usuário.
- **Aceite:** tráfego bloqueado na borda não invoca função nem consulta o banco; limites são validados em preview antes de publicação.

### SEC-04 — Sessões não são revogáveis e podem ser renovadas continuamente

- **Severidade:** alta.
- **Evidência:** logout apenas apaga o cookie no navegador; não existe tabela/lista de sessões. `GET /api/auth/me` emite outro JWT com oito horas a partir de uma sessão ainda válida.
- **Risco:** um token roubado continua válido após logout e pode ser renovado repetidamente enquanto for usado antes da expiração.
- **Correção:** adicionar `session_id`, tabela de sessões, revogação no logout, expiração absoluta e ociosidade; revogar todas as sessões em troca/redefinição de senha; considerar access token curto com refresh rotativo.
- **Aceite:** cookie copiado antes do logout deixa de funcionar imediatamente; renovação não ultrapassa a expiração absoluta.

### SEC-05 — Ambientes e credenciais do banco precisam de isolamento e marcação sensível

- **Severidade:** alta, pendente de confirmação da topologia.
- **Evidência:** a listagem da Vercel mostra `DATABASE_URL`, `PGPASSWORD`, `POSTGRES_PASSWORD` e variáveis relacionadas como `Non-sensitive`, disponíveis para Production, Preview e Development.
- **Risco:** membros com acesso ao projeto podem revelar credenciais que deveriam ser irrecuperáveis; preview pode escrever no banco de produção caso os valores sejam os mesmos.
- **Correção:** converter credenciais para `Sensitive`; confirmar se preview usa branch/banco separado; criar usuários de banco distintos e com menor privilégio; rotacionar senhas após a mudança.
- **Aceite:** produção, preview e desenvolvimento usam credenciais separadas; valores não podem ser revelados no painel após criados.

## P1 — Corrigir antes de ampliar o teste privado

### SEC-06 — Fluxo OAuth do Drive não está vinculado a uma sessão iniciadora no servidor

- **Severidade:** média-alta.
- **Evidência:** o `state` assinado contém `userId`, URL e histórico, mas não existe nonce de uso único persistido. O callback grava a conexão pelo ID do token sem confirmar que a sessão atual corresponde ao usuário que iniciou o fluxo.
- **Risco:** cenário de login/account-linking CSRF pode fazer outra pessoa autorizar o Drive dela para a conta CandTech de quem iniciou o link. O escopo `drive.file` reduz o impacto, mas ainda permite criação de arquivos não desejados e associação incorreta.
- **Correção:** persistir transação OAuth de uso único com hash do nonce, sessão, usuário, expiração e consumo; exigir correspondência da sessão no callback; usar PKCE; separar segredo de estado OAuth do segredo de sessão.
- **Aceite:** link iniciado por uma conta não pode ser concluído em outra sessão e o mesmo `state` não pode ser reutilizado.

### SEC-07 — Enumeração e diferença de tempo no login/cadastro

- **Severidade:** média.
- **Evidência:** cadastro retorna explicitamente que o e-mail já possui conta; login não executa bcrypt fictício quando o e-mail não existe.
- **Risco:** atacante pode descobrir contas válidas por resposta do cadastro ou diferença de tempo e direcionar phishing/credential stuffing.
- **Correção:** respostas públicas neutras; comparação com hash fictício para usuário inexistente; limites por hash de e-mail, IP e combinação; alertas de pulverização de senha.
- **Aceite:** conta existente e inexistente produzem resposta e tempo estatisticamente semelhantes.

### SEC-08 — Injeção de fórmula no CSV da exportação personalizada

- **Severidade:** média.
- **Evidência:** `history-csv.js` neutraliza textos iniciados por `=`, `+`, `-` ou `@`, mas o CSV criado diretamente por `exportSelected()` apenas duplica aspas.
- **Risco:** descrição, parceiro ou localização controlados pelo usuário podem virar fórmula quando o arquivo é aberto no Excel.
- **Correção:** reutilizar uma única função server-side de célula segura em todas as exportações; testar os quatro prefixos e espaços/caracteres de controle antes deles.
- **Aceite:** todas as modalidades CSV/XLSX geram texto literal para entradas potencialmente executáveis.

### SEC-09 — Histórico sem paginação e geradores com limites apenas por bytes

- **Severidade:** média.
- **Evidência:** `listHistories()` devolve todos os registros e payloads do usuário, sem `LIMIT`. PDF aceita até 500 KB, mas percorre todas as linhas; não há limite estrutural de tabelas ou timeout próprio.
- **Risco:** crescimento do histórico aumenta memória, transferência e tempo; muitas linhas pequenas podem tornar PDF/XLSX caros mesmo dentro do limite de bytes.
- **Correção:** paginação por cursor; listagem apenas de metadados; endpoint separado para abrir o payload; limites de linhas, colunas e páginas; processamento assíncrono para relatórios grandes.
- **Aceite:** tempo e memória permanecem limitados com histórico extenso e relatório no máximo permitido.

### SEC-10 — Painel de moderação pode transmitir falsa sensação de proteção

- **Severidade:** média.
- **Evidência:** o painel soma apenas contadores que já chegaram ao rate limit do banco. Ele não mede páginas estáticas, bloqueios DDoS, erros, latência, distribuição entre regiões ou tráfego abaixo do limite por muitos IPs.
- **Risco:** ataque distribuído pode ocorrer enquanto o painel mostra “Normal”.
- **Correção:** rotular as métricas como amostra de APIs; integrar Vercel Observability/Firewall e alertas externos; registrar erros estruturados; definir limites com base em tráfego real.
- **Aceite:** painel informa cobertura e atraso dos dados e aponta claramente para telemetria de borda.

### SEC-11 — CSP permite scripts e estilos inline

- **Severidade:** média.
- **Evidência:** produção envia `script-src 'self' 'unsafe-inline'` e `style-src 'self' 'unsafe-inline'`.
- **Risco:** uma futura falha de injeção terá impacto maior, pois código inline pode ser aceito. React reduz a exposição atual, mas não substitui CSP restritiva.
- **Correção:** remover `unsafe-inline` de scripts com nonce/hash compatível com Next.js; avaliar estilos separadamente; adicionar testes de cabeçalhos.
- **Aceite:** aplicação funciona em produção sem `unsafe-inline` em `script-src` e violações são monitoradas.
- **Situação em 23/08/2026:** corrigido na branch `anterior`. Páginas usam nonce único por requisição e `strict-dynamic`; `script-src` e `style-src` não contêm `unsafe-inline`. Atributos de estilo usados por gráficos permanecem explicitamente separados em `style-src-attr`, e o build, a resposta HTTP e a renderização em navegador foram verificados.

### SEC-12 — Banco é criado durante a inicialização e exige privilégios DDL

- **Severidade:** média.
- **Evidência:** `createPostgresBackend()` executa `CREATE TABLE IF NOT EXISTS` no primeiro acesso da instância.
- **Risco:** credencial da aplicação precisa criar estruturas; comprometimento dessa credencial tem impacto maior e inicializações concorrentes adicionam operações administrativas ao caminho de requisição.
- **Correção:** migrations versionadas fora do runtime; usuário da aplicação limitado a `SELECT/INSERT/UPDATE/DELETE` nas tabelas necessárias.
- **Aceite:** build/deploy executa migrations controladas e a credencial de runtime não possui `CREATE/ALTER/DROP`.
- **Situação em 20/08/2026:** DDL e reparos foram removidos do runtime PostgreSQL e há teste de regressão. Permanece pendente confirmar no Neon que a credencial da aplicação não possui privilégios DDL.

## P2 — Endurecimento empresarial

### SEC-13 — Mesmo segredo usado para sessão e estado OAuth

- **Severidade:** média-baixa.
- **Evidência:** `JWT_SECRET` assina tanto `finsight_token` quanto o `state` do Google Drive.
- **Risco:** comprometimento ou rotação afeta simultaneamente autenticação e OAuth, ampliando o raio de impacto.
- **Correção:** chaves distintas, versionadas e com procedimento de rotação; validar comprimento e entropia na inicialização.
- **Aceite:** segredos separados e rotação de um fluxo não invalida nem compromete o outro.

### SEC-14 — Ausência de MFA, verificação de e-mail e recuperação segura

- **Severidade:** média para oferta empresarial.
- **Evidência:** autenticação atual oferece somente e-mail e senha; não existem segundo fator, verificação ou recuperação.
- **Risco:** maior impacto de senha reutilizada, phishing e perda de acesso.
- **Correção:** verificação de e-mail; recuperação com token de uso único; MFA por TOTP ou passkey; autenticação recente para exportações e alterações sensíveis.
- **Aceite:** fluxos possuem proteção contra enumeração, abuso e reutilização de token.

### SEC-15 — Falta trilha de auditoria de segurança e financeira

- **Severidade:** média para empresas.
- **Evidência atual:** `audit_events` v2 separa autor e conta afetada, organização, origem, versão, objeto e antes/depois minimizado. Tokens e campos sensíveis são removidos; excesso é substituído por tamanho e SHA-256. Autenticação, aceite jurídico, equipe interna/empresarial e Pix já emitem eventos estruturados. Ainda faltam exportações/Drive, política de consulta/retenção e aplicação da migration no Neon.
- **Risco:** não é possível provar quem alterou valor, exportou dados, conectou Drive ou mudou permissão.
- **Correção:** eventos append-only com usuário, empresa, ação, origem, data e antes/depois minimizado; retenção e acesso restrito.
- **Aceite:** eventos sensíveis podem ser investigados sem expor senhas, tokens ou documentos completos. **Situação: parcialmente implementada e coberta por testes locais.**

### SEC-16 — Ausência de testes automatizados de segurança

- **Severidade:** média-baixa.
- **Evidência atual:** existem testes de limite de payload, campos perigosos, autorização entre empresas, adulteração de identificadores e presença de autenticação nas APIs privadas. Ainda faltam testes de integração completos para CSRF/origem, revogação de sessão, OAuth, rate limit e todos os verbos de cada entidade futura.
- **Risco:** regressões de autorização podem chegar à produção sem detecção.
- **Correção:** suíte de integração com dois usuários e duas organizações; casos negativos para todos os verbos; testes de limites e cabeçalhos; execução obrigatória antes do merge.
- **Aceite:** CI bloqueia merge quando isolamento ou controles falham. **Situação: CI versionado com testes, build, auditoria de dependências, CodeQL e Gitleaks; regras de proteção da branch ainda precisam ser confirmadas no GitHub.**

### SEC-17 — Backup, restauração e resposta a incidentes não estão comprovados

- **Severidade:** média operacional.
- **Evidência atual:** os runbooks `BACKUP-E-RESTAURACAO.md` e `PLANO-RESPOSTA-INCIDENTES.md` definem escopo, metas provisórias, contenção e critérios de evidência. Ainda não há restauração integral cronometrada nem exercício real registrado.
- **Risco:** falha humana, exclusão ou incidente pode resultar em perda prolongada de dados.
- **Correção:** definir RPO/RTO; automatizar backup; testar restauração; criar runbook de incidente e responsáveis.
- **Aceite:** restauração é testada periodicamente e o tempo real fica dentro do RTO.

### SEC-18 — Moderação autorizada por e-mail não verificado

- **Severidade:** média; alta se o painel passar a acessar ou alterar dados de clientes.
- **Evidência:** o cadastro aceita qualquer endereço sintaticamente válido sem confirmar sua propriedade; o endpoint administrativo compara `payload.email` do JWT com `ADMIN_EMAILS`.
- **Risco:** um e-mail incluído na lista antes de sua conta legítima existir pode ser registrado por terceiro e receber acesso administrativo. A conta atualmente cadastrada e protegida pela restrição `UNIQUE` reduz o risco imediato, mas o modelo não é seguro para crescer.
- **Correção:** verificar e-mail antes de conceder privilégios; armazenar papel administrativo no banco ligado a `user_id` imutável; exigir MFA e autenticação recente; registrar concessão e retirada de papel.
- **Aceite:** registrar apenas o texto de um e-mail permitido não concede moderação; promoção exige usuário verificado e evento auditado.

## Ordem executiva recomendada

1. Corrigir `.vercelignore` e rotacionar qualquer credencial potencialmente enviada.
2. Separar banco/credenciais entre produção e preview e torná-las sensíveis.
3. Implementar limite real de corpo e limites estruturais.
4. Criar sessões revogáveis.
5. Colocar WAF em modo de observação e depois aplicar limites de borda validados.
6. Corrigir vínculo OAuth e injeção de fórmula.
7. Paginar histórico e limitar exportações.
8. Vincular moderação a usuário verificado, papel persistido e MFA.
9. Adicionar testes de segurança, auditoria e backup.
10. Endurecer CSP e demais controles empresariais.

## Critério para teste privado e comercialização

- **Teste privado pequeno:** corrigir SEC-01, SEC-02, SEC-04, SEC-08 e confirmar isolamento da SEC-05; observar WAF antes de bloquear.
- **Piloto com empresas:** concluir todos os itens P0 e P1, testes de isolamento, backup e auditoria básica.
- **Venda empresarial:** concluir P2 aplicável, pentest independente, plano de incidentes e evidências de funcionamento em produção.
