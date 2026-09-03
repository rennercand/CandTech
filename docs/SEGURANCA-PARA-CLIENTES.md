# Segurança da informação — apresentação para clientes

Atualizado em 2 de setembro de 2026.

## Resumo executivo

A CandTech protege os dados em camadas: identidade, autorização, isolamento entre empresas, proteção do tráfego, tratamento seguro de arquivos, auditoria e prevenção de regressões. Nenhum controle isolado é tratado como garantia absoluta; a segurança depende da combinação de barreiras técnicas, testes e procedimentos operacionais.

## Controles implementados

### Identidade e acesso

- senha armazenada somente como hash forte com bcrypt, nunca em texto puro;
- confirmação de e-mail e recuperação por token de uso único e curta duração;
- sessão assinada, persistida, revogável e com expiração absoluta;
- cookie de sessão `HttpOnly`, `Secure` em produção e `SameSite=Lax`;
- MFA TOTP obrigatório para proprietários e equipe administrativa;
- códigos de recuperação armazenados somente como hash;
- funções separadas para proprietário, gerente, atendente, suporte, cobrança e monitoramento, sempre verificadas novamente no servidor.

### Separação dos dados de cada empresa

- empresa e proprietário são derivados da sessão autenticada, não de um identificador escolhido pelo navegador;
- consultas e alterações combinam usuário, organização e identificador do recurso;
- URLs privadas usam UUID aleatório em vez do número sequencial do banco;
- tentativas com identificador de outra empresa retornam acesso negado ou recurso não encontrado;
- testes automatizados usam duas organizações para detectar leitura e alteração cruzadas.

### Aplicação, APIs e banco

- APIs privadas exigem autenticação no servidor;
- comandos SQL usam parâmetros, reduzindo risco de injeção;
- requisições possuem limites de tamanho, profundidade, quantidade de campos e frequência;
- mutações validam origem e tipo de conteúdo;
- operações críticas e repetíveis usam idempotência persistida quando aplicável;
- migrations são versionadas e não são executadas automaticamente pela aplicação em produção;
- segredos e conexões ficam em variáveis de ambiente do servidor e não usam o prefixo público do navegador.

### Navegador e transporte

- produção opera em HTTPS pela infraestrutura da Vercel;
- Content Security Policy com nonce por requisição restringe a execução de scripts;
- HSTS força conexões seguras;
- proteção contra iframe, detecção incorreta de conteúdo e vazamento excessivo de referência;
- arquivos exportados neutralizam fórmulas potencialmente perigosas ao abrir no Excel.

### Pix, comprovantes e integrações

- a chave Pix permanece no servidor e o QR Code é validado antes de ser entregue ao usuário autenticado;
- comprovantes usam armazenamento privado, limite de 5 MB, formatos permitidos, verificação da assinatura binária e hash SHA-256;
- o envio do comprovante não libera a assinatura: a ativação exige conferência administrativa;
- tokens do Google Drive são cifrados com AES-256-GCM;
- OAuth do Drive usa PKCE, transação vinculada à sessão, expiração e consumo único;
- a CandTech não armazena senha bancária nem dados de cartão.

### Monitoramento, auditoria e desenvolvimento seguro

- erros são registrados em formato estruturado com remoção de senhas, tokens, documentos e outros segredos;
- acessos administrativos exigem sessão, e-mail verificado, aceite jurídico, MFA e permissão atual;
- eventos críticos registram autor, empresa, origem, objeto e alteração minimizada;
- a auditoria administrativa é paginada e restrita à conta raiz com MFA;
- testes automatizados, build, auditoria de dependências, CodeQL e Gitleaks fazem parte do processo de integração contínua;
- a revisão atual possui 124 testes automatizados aprovados e build de produção válido.

### Privacidade e LGPD

- coleta orientada pelo princípio da necessidade;
- nome e e-mail são usados na identificação do pagamento, sem coleta de CPF no fluxo atual;
- Analytics fica desligado sem consentimento e possui lista fechada de eventos, sem nome, e-mail, valores financeiros ou conteúdo do ERP;
- os documentos atuais proíbem venda, aluguel ou monetização dos dados de clientes;
- integrações usam somente os dados necessários para a finalidade solicitada;
- existe processo documentado para direitos dos titulares, incidentes, retenção e eliminação, ainda sujeito à validação jurídica final.

## Como verificamos continuamente

1. Testes negativos tentam acessar dados com conta, organização e UUID incorretos.
2. O CI bloqueia regressões quando testes, build ou auditoria de dependências falham.
3. Eventos administrativos e alterações críticas deixam trilha para investigação.
4. Logs e central privada ajudam a identificar falhas sem exibir credenciais.
5. Mudanças estruturais são aplicadas primeiro em ambiente de Preview e depois validadas em Production.

## Limites que comunicamos com transparência

A CandTech não deve afirmar possuir certificação de segurança, conformidade integral ou risco zero. Ainda estão em processo: pentest independente, exercício cronometrado de restauração completa, confirmação operacional da credencial de banco sem DDL, regras WAF personalizadas e aprovação jurídica dos prazos finais de retenção. O isolamento atual é aplicado pela aplicação; RLS no PostgreSQL não deve ser anunciado como ativo.

## Texto curto para reunião

> A CandTech adota segurança em camadas. Protegemos as contas com confirmação de e-mail, sessões revogáveis e MFA obrigatório nas áreas administrativas. Os dados de cada empresa são isolados no servidor e esse isolamento é testado automaticamente com organizações diferentes. APIs privadas exigem autenticação, as consultas ao banco são parametrizadas e requisições possuem limites contra abuso. Segredos ficam somente no ambiente do servidor, comprovantes Pix usam armazenamento privado e operações críticas geram auditoria. Também mantemos testes, análise de dependências e varredura de segredos no processo de entrega. Não prometemos risco zero nem usamos certificação que ainda não possuímos; mantemos uma agenda explícita de pentest, recuperação de desastre e revisão jurídica antes da expansão empresarial.

## Respostas rápidas

**A CandTech consegue ver todos os meus dados?**  
O acesso interno é limitado por função. Suporte, cobrança e monitoramento possuem permissões separadas; a consulta administrativa sensível exige conta autorizada e MFA e deixa registro de auditoria.

**Uma empresa consegue acessar dados de outra?**  
As consultas usam a organização derivada da sessão no servidor. Alterar um identificador no navegador não muda a empresa autorizada, e esse cenário é coberto por testes negativos automatizados.

**Vocês guardam senha, cartão ou senha bancária?**  
Não. Senhas são armazenadas como hash; a aplicação não guarda dados de cartão nem credenciais bancárias.

**Os dados são vendidos para ferramentas de publicidade?**  
Não. Os documentos e controles atuais proíbem venda ou monetização de dados. Analytics é opcional, depende de consentimento e não recebe dados cadastrais, financeiros ou conteúdo do ERP.

**O sistema possui certificação ou pentest?**  
Ainda não. Existem controles técnicos e testes internos verificáveis, mas o pentest independente e uma eventual certificação são etapas externas ainda pendentes.
