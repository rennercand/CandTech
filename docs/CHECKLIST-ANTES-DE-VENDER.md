# Checklist antes de vender — CandTech

Este documento separa o que já pode ser preparado no código do que exige decisão, credencial ou contratação externa. Ele não é certificação de segurança, conformidade ou prontidão comercial.

## Preparado no código

- cadastro de pessoa física ou empresa;
- página de assinatura sem preço e sem cobrança;
- perfil cadastral de cobrança separado por usuário;
- CPF/CNPJ não é solicitado antes de existir uma finalidade real de cobrança ou emissão;
- nenhum campo de cartão, senha bancária ou conta é armazenado diretamente;
- sessão revogável no servidor e expiração absoluta;
- APIs privadas protegidas por sessão JWT, com teste que detecta rota privada criada sem validação de sessão;
- documentos identificados externamente por UUID aleatório e consultas sempre vinculadas ao proprietário obtido da sessão;
- teste automatizado de IDOR entre duas empresas para leitura, sobrescrita e administração cruzadas;
- auditoria atual de dependências sem vulnerabilidades conhecidas após atualização do `nanoid` transitivo;
- limites estruturais e de bytes nas APIs com corpo JSON;
- limites separados de login e cadastro por IP e identidade normalizada;
- resposta de autenticação mais resistente à enumeração;
- vínculo do OAuth do Drive à sessão iniciadora;
- auditoria inicial de conta, sessão e perfil;
- exclusão explícita dos segredos no pacote de deploy;
- estoque relacional por empresa, com produtos, variações, SKU, entrada rápida, cadastro e entrada por planilha com prévia, pedidos multi-item, movimentações e desfazimento;
- visão de valor do estoque por categoria, alertas de mínimo/validade e relatórios CSV/XLSX com envio opcional ao Google Drive;
- guia de capacitação de estoque e ajuda incorporada à interface;
- pré-nota identificada como documento sem validade fiscal.
- workspace inicial com o resumo do negócio integrado e detalhes operacionais recolhíveis;
- categorias financeiras cadastráveis e reutilizáveis em contas e lançamentos, salvas conforme a permissão do painel financeiro;
- formulário de contas a receber simplificado, sem exigir descrição redundante além do cliente e da categoria;
- cargos personalizados por empresa, permissões reutilizáveis e convite de colaborador vinculado ao e-mail autenticado;
- envio transacional de convite preparado para Resend, com idempotência e alternativa de link copiável quando o provedor não estiver configurado.
- página inicial indexável sem JavaScript, com title e description adequados, canonical no domínio oficial, hierarquia H1/H2 e links internos para planos e privacidade.

## Antes de um teste privado pequeno

- revisar o diff e versionar somente os arquivos pretendidos;
- configurar `OAUTH_STATE_SECRET` diferente de `JWT_SECRET` na Vercel;
- verificar o domínio remetente no Resend, configurar `RESEND_API_KEY` e `TEAM_INVITE_FROM` e confirmar a chegada de um convite real;
- confirmar novamente que Production e Preview usam bancos separados;
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
- escolher provedor de pagamento; CPF/CNPJ quando necessário, cartão e dados bancários devem ser coletados pelo provedor, não pela CandTech;
- implementar webhooks assinados, idempotência, recibos e conciliação de pagamento;
- criar status de assinatura no servidor e autorização por plano;
- não liberar recurso apenas escondendo botão no navegador;
- validar fluxo de falha, pagamento duplicado, estorno e chargeback;
- revisar LGPD, relação com operadores e política de retenção.

## Antes de vender para empresas

- concluir todos os P0 e P1 aplicáveis da roadmap de segurança;
- manter auditoria de dependências obrigatória no CI para impedir regressões conhecidas;
- migrations versionadas e credencial de runtime sem privilégios DDL;
- papéis, permissões e isolamento por empresa testados automaticamente;
- auditoria de alterações financeiras, exportações e permissões;
- backup e restauração realmente testados com RPO/RTO definidos;
- e-mail verificado, recuperação segura e MFA para ações sensíveis;
- teste de carga com orçamento e limites conhecidos;
- pentest independente com correção dos achados críticos e altos;
- plano de incidente, responsáveis e comunicação definidos;
- emissão fiscal oficial somente após homologação e validação contábil.

## Decisões que aguardam o responsável pelo produto

- nomes finais dos planos e preços;
- provedor de pagamento e conta recebedora;
- termos comerciais, prazo de teste e política de reembolso;
- empresa/CNPJ responsável pela venda do serviço;
- ferramentas externas de e-mail, observabilidade, WAF distribuído e suporte;
- autorização para deploy, migração de produção e mudanças no firewall.
