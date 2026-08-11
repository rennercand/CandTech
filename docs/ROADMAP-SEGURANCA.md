# Roadmap de segurança — CandTech

Este documento separa segurança da roadmap comercial. Ele registra riscos, prioridades e critérios de aceite; não significa que os controles já foram implementados nem substitui revisão independente.

## Esclarecimento: buffer overflow no login

Um buffer overflow clássico é improvável no fluxo atual, pois o login é executado em JavaScript/Node.js, com memória gerenciada, e usa bcryptjs. Enviar uma senha enorme não deveria permitir sobrescrever memória do processo.

O risco relevante é exaustão de recursos:

1. o servidor recebe o corpo HTTP;
2. request.json() carrega e interpreta o conteúdo;
3. somente depois a aplicação valida os limites de e-mail e senha;
4. um payload muito grande ou profundamente aninhado pode consumir memória e CPU antes de ser rejeitado.

Portanto, esta roadmap trata esse caso como limite de payload e proteção contra negação de serviço, não como correção de buffer overflow. Dependências nativas ou vulnerabilidades do runtime ainda devem ser atualizadas e monitoradas.

## Prioridades

| Prioridade | Controle | Risco reduzido |
| --- | --- | --- |
| P0 | Limite do corpo antes do parsing | Exaustão de memória/CPU |
| P0 | Rate limit na borda | Abuso atingir função e banco |
| P0 | Limites por IP, conta e usuário | Força bruta distribuída |
| P0 | Sessões revogáveis | Reutilização de token roubado |
| P0 | Autorização multiempresa | Acesso cruzado entre empresas |
| P1 | Auditoria e alertas | Alterações sem rastreabilidade |
| P1 | CSP sem unsafe-inline | Impacto de XSS |
| P1 | Backup e resposta a incidentes | Perda de dados e recuperação lenta |
| P2 | MFA e verificação de e-mail | Tomada de conta |
| P2 | Pentest e monitoramento contínuo | Falhas não identificadas |

## Fase 1 — Payloads e exaustão de recursos

### Login e cadastro

- rejeitar Content-Length acima do permitido antes de request.json();
- aplicar limite real por streaming ou na infraestrutura, sem depender apenas do cabeçalho enviado pelo cliente;
- usar limite inicial de 4 a 8 KB para login e cadastro;
- rejeitar tipos de conteúdo diferentes de application/json;
- limitar profundidade, quantidade de campos e tipos aceitos;
- manter e-mail com no máximo 254 caracteres e senha com no máximo 128;
- estabelecer timeout para a requisição;
- retornar erro genérico sem ecoar o payload.

### Workspace e importações

- manter limite coerente com o tamanho funcional permitido;
- deixar pequena margem acima do limite de 500 KB do workspace;
- validar estrutura antes de processar ou serializar grandes objetos;
- limitar profundidade, número de registros e tamanho por campo;
- processar arquivos grandes fora do caminho síncrono quando necessário;
- testar JSON grande, profundamente aninhado, comprimido e malformado.

### Critérios de aceite

- payload acima do limite é rejeitado antes de bcrypt e banco;
- request.json() não é chamado para Content-Length excessivo;
- ausência ou falsificação de Content-Length não contorna o limite real;
- testes confirmam resposta 413 ou 400 sem crescimento relevante de memória;
- logs não armazenam senha, token, extrato ou corpo completo.

## Fase 2 — Rate limit e proteção contra abuso

O rate limit atual no PostgreSQL reduz abuso, mas cada tentativa ainda pode gerar consulta no banco. Ele não substitui controle na borda.

### Arquitetura desejada

1. Vercel Firewall/WAF e rate limit na borda;
2. Redis/Upstash ou serviço equivalente para contadores distribuídos;
3. aplicação;
4. PostgreSQL/Neon.

### Chaves e escopos

- login por IP;
- login por hash normalizado do e-mail;
- login pela combinação IP + e-mail;
- cadastro separado do login;
- rotas autenticadas por user_id e tenant_id;
- endpoints caros com limites próprios;
- limites específicos para automações e endpoints caros;
- bloqueio progressivo e temporário após falhas;
- proteção contra enumeração de contas.

### Melhorias específicas do login

- executar comparação com hash fictício quando o e-mail não existir, reduzindo diferença de tempo;
- usar mensagem genérica para usuário inexistente ou senha errada;
- registrar falhas sem armazenar a senha;
- detectar muitas contas atacadas pelo mesmo IP e a mesma conta por muitos IPs;
- adicionar desafio adicional somente quando houver comportamento suspeito;
- evitar bloqueio permanente que permita negação de serviço contra a vítima.

### Critérios de aceite

- tráfego bloqueado na borda não consulta o Neon;
- uma botnet pequena não contorna todos os limites apenas trocando IP;
- login e cadastro não consomem o mesmo orçamento;
- usuários de uma mesma escola ou empresa não são bloqueados desnecessariamente;
- contadores expiram e não criam crescimento ilimitado;
- alertas são gerados para padrões anormais.

## Fase 3 — Sessões e autenticação

**Atualização em 10 de agosto de 2026:** passkeys continuam adiadas. Verificação de e-mail e recuperação segura foram implementadas com token de uso único armazenado somente como hash, expiração, resposta anti-enumeração, rate limit e revogação das sessões após redefinição. MFA deverá ser reavaliado antes da venda empresarial ampla e de ações administrativas sensíveis.

- adicionar identificador único de sessão;
- manter sessões ativas no servidor ou uma lista de revogação;
- permitir encerrar uma sessão ou todas as sessões;
- [x] revogar sessões ao redefinir a senha;
- considerar access token curto com renovação segura;
- rotacionar tokens de renovação e detectar reutilização;
- preservar cookies HttpOnly, Secure e SameSite;
- aplicar proteção CSRF adequada ao fluxo;
- [x] adicionar verificação de e-mail;
- oferecer MFA, preferencialmente TOTP ou passkeys;
- [x] proteger recuperação de senha contra enumeração e abuso;
- notificar login novo ou alteração sensível.

### Critérios de aceite

- logout invalida a sessão no servidor;
- token roubado não permanece utilizável por oito horas após revogação;
- mudança de senha encerra sessões anteriores;
- cookies não ficam acessíveis ao JavaScript do navegador;
- ações sensíveis exigem autenticação recente ou segundo fator.

## Fase 4 — Multiempresa e autorização

- criar tenant_id em todas as entidades empresariais;
- validar tenant_id no servidor a partir da sessão, nunca do corpo confiado;
- implementar papéis e permissões;
- negar por padrão;
- testar acesso horizontal entre usuários e empresas;
- limitar exportações, exclusões e configurações a papéis adequados;
- separar permissões de financeiro, estoque, vendas, administração e leitura;
- registrar troca de empresa ativa.

### Critérios de aceite

- nenhum ID informado pelo cliente permite acessar outra empresa;
- testes cobrem leitura, criação, alteração, exclusão e exportação cruzadas;
- consultas sempre incluem o escopo da organização;
- administradores não recebem permissões fora do necessário.

## Fase 5 — Navegador, XSS e entrada de dados

- remover script-src unsafe-inline da CSP;
- usar nonce ou hash quando um script inline for inevitável;
- evitar HTML não sanitizado;
- validar e normalizar dados no servidor;
- proteger fórmulas perigosas em exportações CSV;
- limitar nomes de arquivo, MIME, tamanho e conteúdo de anexos;
- impedir links javascript: e URLs não permitidas;
- revisar redirecionamentos de OAuth;
- manter HSTS, frame-ancestors, nosniff e política de referência.

### Critérios de aceite

- CSP funciona sem unsafe-inline em produção;
- testes cobrem XSS armazenado e refletido;
- células exportadas iniciadas por =, +, - ou @ são neutralizadas quando necessário;
- anexos não são executados no domínio da aplicação.

## Fase 6 — Banco, segredos e disponibilidade

### Estado atual verificado em 5 de agosto de 2026

- PostgreSQL/Neon é usado na Vercel; SQLite é somente fallback local.
- As credenciais críticas de Production e Preview estão marcadas como `Sensitive` na Vercel.
- O navegador não recebe `DATABASE_URL`, senhas do PostgreSQL, `JWT_SECRET` ou chaves do Google Drive.
- Production usa a branch principal do Neon; Preview usa a branch isolada `preview-test`, criada somente com o schema; Development não recebe credenciais PostgreSQL da Vercel.
- A `DATABASE_URL` de Production e a de Preview são entradas distintas e `Sensitive`. O redeploy de Preview foi validado com conexão e as cinco tabelas esperadas.

### Isolamento de ambientes

- manter a branch principal do Neon exclusiva para Production;
- habilitar uma branch Neon isolada para cada Preview Deployment ou, no mínimo, uma branch permanente de staging para a branch Git `test`;
- preferir branch de Preview sem dados pessoais reais; quando necessário, copiar somente o schema e dados fictícios;
- configurar `DATABASE_URL` e demais credenciais de Preview com a URL da branch isolada;
- manter todas as credenciais de Production e Preview como `Sensitive`;
- validar cadastro, login, workspace, histórico, rate limit e Google Drive no Preview antes de qualquer troca em Production;
- impedir que migrations de Preview sejam executadas na branch de Production;
- remover branches efêmeras quando o Preview deixar de existir para controlar custo e retenção de dados.

#### Critérios de aceite do isolamento

- criar um usuário ou lançamento no Preview não altera Production;
- alterar o schema no Preview não modifica nem bloqueia Production;
- o Preview não recebe dados pessoais reais por padrão;
- cada deployment recebe somente a credencial correspondente ao seu ambiente;
- rollback da aplicação não exige copiar segredos para o repositório;
- restauração e rotação de credenciais são testadas e documentadas.

- usar migrations versionadas;
- aplicar princípio do menor privilégio no usuário do banco;
- revisar índices e timeouts de consultas;
- limitar concorrência e operações caras;
- manter segredos apenas nas variáveis protegidas;
- definir rotação de JWT_SECRET, chaves do Drive e credenciais;
- impedir segredos em logs, erros e previews;
- automatizar backup e testar restauração;
- definir RPO e RTO;
- separar produção, preview e desenvolvimento;
- monitorar custos e saturação de Vercel e Neon.

## Fase 7 — Auditoria, LGPD e incidentes

- trilha imutável para login, permissões, exportação, exclusão e alterações financeiras;
- registrar quem, quando, origem e antes/depois sem guardar segredos;
- alertas para acessos suspeitos e mudanças sensíveis;
- política de retenção e exclusão;
- exportação dos dados do titular;
- inventário de dados pessoais e operadores;
- plano de resposta a incidentes;
- canal para reporte de vulnerabilidade;
- procedimento para revogar chaves e sessões;
- comunicação de incidente revisada juridicamente.

## Fase 8 — Segurança de automações e módulos tributários

### Automações determinísticas

- tratar conteúdo de extratos e documentos como dado não confiável;
- validar toda saída contra schema;
- impedir ações financeiras silenciosas;
- registrar regra, versão e resultado;
- limitar custo e frequência por empresa;
- permitir revisão humana e reversão.

### Tributação e split payment

- cálculo determinístico no servidor;
- regras versionadas por vigência;
- testes de referência;
- memória de cálculo;
- separação entre simulação e apuração oficial;
- nenhuma decisão de alíquota ou crédito feita por regra não versionada;
- validação por contador ou especialista;
- controle de integridade entre pedido, documento, pagamento e imposto.

## Verificação antes de vender para empresas

- análise de dependências e atualização do runtime;
- testes automatizados de autenticação e autorização;
- testes de carga com limites definidos;
- revisão independente de segurança;
- pentest com autorização e escopo formal;
- correção de achados críticos e altos;
- restauração de backup testada;
- monitoramento e alertas ativos;
- responsável e prazo para resposta a incidentes;
- evidências de que os controles funcionam em produção.

## Fora de escopo deste documento

- promessa de sistema invulnerável;
- execução de testes destrutivos em produção;
- classificação de um payload grande como buffer overflow sem evidência;
- uso do rate limit do banco como única proteção DDoS;
- afirmação de conformidade ou certificação sem auditoria adequada.
