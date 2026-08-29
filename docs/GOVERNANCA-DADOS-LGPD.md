# Governança de dados e LGPD

Revisão operacional de 28 de agosto de 2026. Este documento registra controles do produto e pendências de governança; não substitui parecer jurídico, contratos com fornecedores ou avaliação de impacto quando exigida.

## Princípios adotados

- coletar somente o necessário para conta, serviço, segurança, suporte e pagamento;
- não vender, alugar, trocar ou monetizar dados pessoais ou conteúdo do ERP;
- manter Google Analytics desligado por padrão e sem dados cadastrais, financeiros ou empresariais;
- separar o papel de controladora da CandTech dos casos em que ela atua como operadora do cliente B2B;
- revisar finalidade, base legal, retenção, acesso e transferência internacional antes de adicionar fornecedor.

## Inventário resumido

| Grupo | Dados principais | Finalidade | Acesso |
| --- | --- | --- | --- |
| Conta | nome, e-mail, tipo de conta, hash de senha, verificação e aceites | cadastro, autenticação e contrato | titular e funções autorizadas |
| Pix | nome, e-mail, referência, valor, prazo, estado e comprovante | cobrança e moderação humana | titular e moderadores de pagamento |
| ERP | finanças, estoque, pedidos, equipe, relatórios e históricos inseridos | execução do serviço | organização do cliente |
| Suporte e segurança | mensagens, sessão, IP ou hash de IP, eventos e auditoria | atendimento, prevenção de abuso e incidentes | suporte ou administradores conforme função |
| Integrações | tokens cifrados do Drive e exportações autorizadas | recurso opcional solicitado pelo usuário | conta autorizadora e serviço integrado |
| Analytics | páginas, origem aproximada, dispositivo e eventos mínimos | medição opcional do site | equipe responsável e Google após consentimento |

## Fornecedores atuais

| Fornecedor | Função | Regra de minimização |
| --- | --- | --- |
| Vercel | hospedagem, funções, rede e arquivos privados | somente dados necessários para entregar e proteger o serviço |
| Neon | PostgreSQL | banco acessível por credenciais restritas do servidor |
| Resend | e-mail transacional | destinatário e conteúdo necessário à mensagem |
| Google Drive | exportação opcional | somente após autorização e para o arquivo solicitado |
| Google Analytics | medição do site | somente após consentimento; sem nome, e-mail, tipo de conta, pagamento ou ERP |

O projeto Neon está em organização gerenciada pela integração da Vercel e a conta proprietária possui acesso administrativo direto ao Neon Console. O acesso deve usar senha ou provedor de login próprio, 2FA e credenciais individuais; segredos de conexão nunca devem ser enviados ao navegador ou publicados no repositório.

## Regras para Analytics e futuras ferramentas

1. A ferramenta não pode carregar antes do consentimento.
2. Recusar precisa ser tão fácil quanto aceitar e não pode limitar o ERP.
3. Parâmetros permitidos ficam em lista fechada no código.
4. Nome, e-mail, tipo de conta, IDs internos, valores, pagamento e conteúdo do ERP são proibidos em eventos.
5. Google Signals, compartilhamento para “produtos e serviços Google”, personalização de anúncios e vínculos com plataformas de publicidade devem permanecer desligados até avaliação específica.
6. A retenção da propriedade deve usar o menor prazo compatível com a finalidade e ser revisada no console do fornecedor.
7. Venda, corretagem, enriquecimento ou monetização de dados não estão cobertos pelos documentos ou pelo consentimento atuais e não podem ser ativados sem revisão jurídica, contratual e técnica.

## Retenção e eliminação

- confirmação de e-mail: 24 horas;
- redefinição de senha: 30 minutos;
- sessão comum: 8 horas;
- incidentes com dados pessoais: pelo menos 5 anos;
- demais dados: durante a conta e depois somente enquanto houver obrigação, necessidade contratual, prevenção de fraude ou exercício de direitos;
- backups: ciclo técnico restrito, sem restauração para uso comum após pedido válido de eliminação;
- Analytics: conforme prazo mínimo validado na propriedade, com pedidos de exclusão feitos também no Google quando aplicável.

## Checklist antes de vender ou ampliar o produto

- designar responsável pelo canal de privacidade e manter registro dos pedidos de titulares;
- validar contratos, termos de tratamento e localização de Vercel, Neon, Resend e Google;
- confirmar no Google Analytics que compartilhamentos opcionais, Signals e publicidade estão desligados;
- definir e executar rotina de retenção para comprovantes, suporte, auditoria, arquivos e backups;
- manter registro de consentimento e da versão dos avisos exibidos;
- manter plano de resposta, registro de incidentes por cinco anos e capacidade de comunicar em três dias úteis quando obrigatório;
- realizar avaliação de legítimo interesse ou relatório de impacto para tratamentos de maior risco;
- obter revisão jurídica brasileira antes de vendas em escala, publicidade comportamental, dados sensíveis ou entrada em novo país.

## Referências oficiais da revisão

- [Lei Geral de Proteção de Dados Pessoais — texto compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [ANPD — Guia Orientativo: Cookies e Proteção de Dados Pessoais](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf)
- [ANPD — direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares)
- [ANPD — Resolução CD/ANPD nº 15/2024, comunicação de incidentes](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca)
- [ANPD — Resolução CD/ANPD nº 19/2024, transferências internacionais](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024)
- [Google Analytics — modo de consentimento](https://support.google.com/analytics/answer/10000067)
- [Google Analytics — configurações de compartilhamento](https://support.google.com/analytics/answer/1011397)
- [Neon — gestão de membros e colaboradores](https://neon.com/docs/manage/orgs-manage)
