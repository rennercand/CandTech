# Checklist antes de vender — CandTech

Este documento separa o que já pode ser preparado no código do que exige decisão, credencial ou contratação externa. Ele não é certificação de segurança, conformidade ou prontidão comercial.

## Preparado no código

- cadastro de pessoa física ou empresa;
- página de assinatura com plano único, Pix manual e ativação exclusivamente administrativa;
- perfil cadastral de cobrança separado por usuário;
- CPF não é solicitado no cadastro nem na pré-nota atual; CNPJ do emitente é opcional e dados exigidos na cobrança ficam no ambiente do provedor;
- nenhum campo de cartão, senha bancária ou conta é armazenado diretamente;
- sessão revogável no servidor e expiração absoluta;
- confirmação de e-mail e recuperação de senha com tokens de uso único, hash no banco, expiração, resposta anti-enumeração e encerramento das sessões anteriores;
- MFA TOTP obrigatório para proprietários/equipe administrativa, com segredo cifrado, desafio de uso único e códigos de recuperação;
- APIs privadas protegidas por sessão JWT, com teste que detecta rota privada criada sem validação de sessão;
- documentos identificados externamente por UUID aleatório e consultas sempre vinculadas ao proprietário obtido da sessão;
- teste automatizado de IDOR entre duas empresas para leitura, sobrescrita e administração cruzadas;
- auditoria atual de dependências sem vulnerabilidades conhecidas após atualização do `nanoid` transitivo;
- limites estruturais e de bytes nas APIs com corpo JSON;
- comprovante Pix privado com limite de 5 MB, formatos fechados, conferência de assinatura binária, hash, vínculo ao proprietário e auditoria de envio/visualização/substituição;
- limites separados de login e cadastro por IP e identidade normalizada;
- resposta de autenticação mais resistente à enumeração;
- vínculo do OAuth do Drive à sessão iniciadora;
- auditoria inicial de conta, sessão e perfil;
- exclusão explícita dos segredos no pacote de deploy;
- estoque relacional por empresa, com produtos, variações, SKU, entrada rápida, cadastro e entrada por planilha com prévia, leitura de catálogos comerciais com títulos e saldo inicial zero, pedidos multi-item, movimentações e desfazimento;
- visão de valor do estoque por categoria, alertas de mínimo/validade e relatórios CSV/XLSX com envio opcional ao Google Drive;
- guia de capacitação de estoque e ajuda incorporada à interface;
- pré-nota identificada como documento sem validade fiscal.
- workspace inicial com o resumo do negócio integrado e detalhes operacionais recolhíveis;
- categorias financeiras cadastráveis e reutilizáveis em contas e lançamentos, salvas conforme a permissão do painel financeiro;
- formulário de contas a receber simplificado, sem exigir descrição redundante além do cliente e da categoria;
- cargos personalizados por empresa, permissões reutilizáveis e convite de colaborador vinculado ao e-mail autenticado;
- convite com tela própria de ingresso, prévia segura da empresa e do cargo, criação ou login da conta e abertura direta do workspace conforme as permissões recebidas;
- envio transacional de convite preparado para Resend, com idempotência e alternativa de link copiável quando o provedor não estiver configurado.
- página inicial indexável sem JavaScript, com title e description adequados, canonical no domínio oficial, hierarquia H1/H2 e links internos para planos e privacidade.
- telas de recuperação para falhas inesperadas locais e globais, sem expor detalhes técnicos ao cliente;
- logs de erro das APIs em formato estruturado, com remoção de credenciais, e-mails e documentos; mensagens livres não são registradas em produção;
- CI no GitHub para as branches `test` e `main`, bloqueando vulnerabilidades altas/críticas e exigindo testes e build válidos.
- central privada mostra a prontidão comercial da configuração de Production sem devolver chaves, tokens, conexões ou e-mails administrativos; bloqueios essenciais ficam separados de avisos e integrações opcionais.
- trilha de auditoria paginada disponível somente para a conta raiz com MFA; a consulta registra o próprio acesso e não concede leitura às contas internas de suporte ou cobrança.

## Antes de um teste privado pequeno

- revisar o diff e versionar somente os arquivos pretendidos;
- abrir **Central privada → Visão do sistema → Prontidão para começar a vender** e não iniciar cobrança enquanto existir bloqueio;
- configurar `OAUTH_STATE_SECRET` diferente de `JWT_SECRET` na Vercel;
- verificar o domínio remetente no Resend, configurar `RESEND_API_KEY`, `TEAM_INVITE_FROM` e `PUBLIC_APP_URL`, e confirmar a chegada de convite, verificação de cadastro e recuperação de senha reais;
- confirmar novamente que Production e Preview usam bancos separados;
- criar stores Blob **Private** separados para Production e Preview e confirmar que nenhum URL funciona sem autenticação;
- aplicar `migrations/20260826_staff_access.sql`, criar uma conta de suporte e outra de cobrança e confirmar que cada uma recebe somente sua aba;
- revogar uma conta interna durante uma sessão aberta e confirmar que a próxima requisição recebe acesso negado;
- rotacionar credenciais que possam ter sido copiadas ou enviadas no passado;
- publicar primeiro na branch `test` e verificar cadastro, login, logout, Drive, perfil e estoque;
- importar uma entrada em SKU existente, conferir o novo saldo e desfazer a operação no preview;
- baixar CSV/XLSX do estoque e abrir os dois arquivos; quando o Drive estiver configurado, conferir o arquivo enviado pela conta conectada;
- repetir no preview os testes negativos de API sem JWT, UUID adulterado e exclusão cruzada;
- habilitar observação no Firewall/WAF e criar alertas de erro e tráfego;
- verificar cabeçalhos, cookies e limites no domínio publicado;
- publicar termos de uso, política de privacidade e canal de suporte revisados por profissional adequado.

## Marketing e medição antes do lançamento

- criar a propriedade GA4 e informar apenas o Measurement ID `G-...` em `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID`;
- confirmar que `https://www.candtech.com.br` continua sendo o domínio comercial e canônico definitivo;
- definir `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL` e completar a identificação da empresa responsável;
- revisar juridicamente a página de privacidade e publicar termos de uso, política de cookies e canal de suporte;
- cadastrar sitemap e domínio no Google Search Console;
- marcar como conversões somente cadastro e lead comercial, sem enviar dados financeiros ou campos pessoais;
- definir uma página pública de apresentação com proposta de valor, público-alvo, limitações do MVP, demonstração e chamada para piloto;
- criar perfil da empresa no Google somente quando houver nome comercial, contato e atendimento reais;
- medir origem, cadastro, interesse no plano e ativação do piloto antes de investir em anúncios pagos;
- não ativar remarketing ou publicidade personalizada sem decisão jurídica, finalidade documentada e consentimento correspondente.

## Antes de cobrar qualquer valor

- definir planos, preços, impostos, cancelamento, reembolso e suporte;
- confirmar que a conta recebedora e a chave Pix pertencem a uma pessoa legalmente apta a vender o serviço;
- documentar conferência manual, recibo, vencimento, reembolso e conciliação do Pix;
- criar status de assinatura no servidor e autorização por plano;
- não liberar recurso apenas escondendo botão no navegador;
- validar solicitação repetida, pagamento não localizado, aprovação indevida, rejeição, vencimento e reembolso;
- aplicar `migrations/20260826_pix_payment_receipts.sql` e testar PDF/JPG/PNG/WEBP, arquivo falso, arquivo acima de 5 MB, substituição e acesso cruzado;
- definir prazo de retenção e rotina de exclusão dos comprovantes rejeitados ou antigos;
- revisar LGPD, relação com operadores e política de retenção.

## Antes de vender para empresas

- concluir todos os P0 e P1 aplicáveis da roadmap de segurança;
- manter auditoria de dependências obrigatória no CI para impedir regressões conhecidas;
- migrations versionadas e credencial de runtime sem privilégios DDL;
- papéis, permissões e isolamento por empresa testados automaticamente;
- auditoria de alterações financeiras, exportações e permissões;
- manter a trilha de auditoria sob retenção protegida, sem exclusão automática, até os prazos por categoria serem aprovados na revisão jurídica; documentar e testar a futura rotina antes de ativá-la;
- backup e restauração realmente testados com RPO/RTO definidos;
- [x] e-mail verificado, recuperação segura e MFA para áreas administrativas e gestão de equipe;
- teste de carga com orçamento e limites conhecidos;
- pentest independente com correção dos achados críticos e altos;
- plano de incidente, responsáveis e comunicação definidos;
- emissão fiscal oficial somente após homologação e validação contábil.

## Decisões que aguardam o responsável pelo produto

- nomes finais dos planos e preços;
- conta recebedora, chave Pix e responsável pela conferência;
- termos comerciais, prazo de teste e política de reembolso;
- empresa/CNPJ responsável pela venda do serviço;
- ferramentas externas de e-mail, observabilidade, WAF distribuído e suporte;
- autorização para deploy, migração de produção e mudanças no firewall.
