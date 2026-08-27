# Monitoramento privado e suporte

## Resultado

A CandTech possui uma central operacional com endereço não publicado. O administrador principal acessa pelo ERP em **Moderação → Abrir central privada** e concede à equipe somente os módulos necessários. A página é renderizada depois de validar a chave do caminho, o JWT, a sessão persistida, o e-mail verificado, o aceite jurídico e a permissão atual. Uma chave incorreta ou uma conta sem permissão recebe uma página não encontrada; visitantes sem sessão são enviados ao login.

A sessão autenticada recebe somente a decisão `administrator`, as permissões administrativas atuais e, quando autorizada, o caminho privado. A assinatura não é exigida para trabalhar na central: uma conta interna sem plano vê uma entrada operacional limitada, sem acesso ao ERP financeiro.

A lista é o documento vivo solicitado: ela se atualiza a cada 20 segundos quando a aba está visível e pode ser atualizada manualmente. Um arquivo Word ou PDF seria apenas um retrato estático e ficaria desatualizado assim que surgisse um novo incidente.

## Configuração obrigatória

Na Vercel, configure em Production e Preview:

```env
ADMIN_EMAILS=seu-email-de-administrador@exemplo.com
NEXT_PUBLIC_SUPPORT_EMAIL=atendimento@exemplo.com
NEXT_PUBLIC_SUPPORT_PHONE="+55 11 00000-0000"
# Opcional. Use 24 a 80 letras, números, _ ou -. Se ficar vazio, a rota é
# derivada de JWT_SECRET e continua sem aparecer no código ou na documentação.
ADMIN_MONITORING_SLUG=
```

`ADMIN_EMAILS` contém somente os administradores principais que podem gerenciar a equipe e não deve usar um e-mail compartilhado. As permissões delegadas ficam em `staff_access`. `ADMIN_MONITORING_SLUG` é apenas uma camada adicional contra varreduras; JWT, sessão e autorização continuam sendo a segurança real. As duas variáveis `NEXT_PUBLIC_SUPPORT_*` são públicas porque aparecem propositalmente na aba Suporte.

## O que é registrado automaticamente

- falhas tratadas pelas APIs que chamam `reportServerError`;
- erros capturados pelos limites de erro global e de rota do React;
- exceções não tratadas e rejeições de Promise ocorridas no navegador de uma pessoa autenticada;
- rota, ambiente, tipo genérico da falha, quantidade de ocorrências e horários.

Falhas iguais usam um `fingerprint` estável e incrementam `occurrences`, evitando centenas de linhas repetidas. Se uma falha marcada como resolvida reaparecer, o incidente volta automaticamente para `open`.

## O que não é registrado

- senhas, JWTs, cookies, chaves de API ou credenciais do banco;
- conteúdo de workspace, valores financeiros, documentos ou dados de cartão;
- mensagens livres do banco de dados em produção;
- stack traces apresentados ao navegador ou à central.

O painel ajuda na triagem, mas não substitui os Runtime Logs da Vercel durante uma investigação profunda. Sentry ou Vercel Drains podem ser conectados no futuro quando o volume justificar o custo.

## Fluxo de suporte

1. A pessoa autenticada abre **Suporte** no menu do ERP.
2. Ela escolhe resposta pelo sistema, e-mail ou telefone e descreve o problema.
3. A API ignora qualquer identificador de usuário enviado pelo navegador e associa o chamado ao usuário da sessão JWT.
4. Uma conta interna com permissão **Suporte** lê a mensagem na seção **Mensagens** da central privada.
5. A resposta é salva no chamado e aparece para a pessoa na aba Suporte, atualizada a cada 30 segundos. A preferência por e-mail ou telefone orienta um contato manual; a cópia no sistema permanece como histórico.

Cada usuário consulta somente os próprios chamados. Apenas a equipe com permissão **Suporte** consulta todos para realizar o atendimento. Não se deve pedir senha, chave, número completo de cartão ou documento pessoal no formulário.

## Conferência de pagamentos Pix

A seção **Pagamentos Pix** é carregada somente para contas com permissão **Cobrança**. Ela exibe referência, valor, cliente, vencimento e estado da solicitação. Aprovar, rejeitar e abrir comprovantes exigem essa permissão também na API.

- **Aprovar:** use somente depois de localizar valor e referência no extrato da conta recebedora. A assinatura recebe 30 dias.
- **Rejeitar:** suspende a assinatura e inicia a tentativa de envio do backup ao e-mail verificado do proprietário.
- **Expirado:** o cron diário suspende e tenta enviar o mesmo backup.

O botão de WhatsApp do cliente apenas prepara uma mensagem; ele não confirma o pagamento. Caso o envio de backup falhe, a coluna permanece sem confirmação e o cron tenta novamente.

## Estados

Incidentes: `open`, `investigating`, `resolved`.

Chamados: `open`, `answered`, `closed`.

Pagamentos Pix: `pending`, `payment_review`, `approved`, `rejected`, `expired`.

## Banco e migração

O SQLite local cria as tabelas automaticamente. No PostgreSQL/Neon, execute também `migrations/20260826_pix_payment_receipts.sql` e `migrations/20260826_staff_access.sql` antes deste deploy; o runtime não altera a estrutura do banco.

## Verificação antes de publicar

1. Confirmar `ADMIN_EMAILS` na Vercel sem espaços ou erros de digitação.
2. Entrar com o administrador principal, abrir **Moderação** e usar o botão da central privada.
   Se a sessão já estava aberta quando `ADMIN_EMAILS` foi alterado, sair e entrar novamente ou atualizar a página para renovar os dados da interface.
3. Criar contas verificadas separadas para Suporte e Cobrança e conceder cada permissão em **Equipe interna**.
4. Confirmar que cada conta enxerga somente sua aba e recebe `403` ao chamar diretamente uma API não concedida.
5. Enviar uma mensagem de teste pela aba Suporte e responder pela central.
6. Confirmar que a resposta aparece somente na conta que enviou o chamado.
7. Gerar um Pix controlado, enviar comprovante, aprovar outro, rejeitar um terceiro e confirmar o ZIP no e-mail do proprietário.
8. Revogar uma conta interna e confirmar que a próxima requisição perde o acesso.
9. Rodar `npm test` e `npm run build`.

O procedimento completo de criação e revogação de logins está em [ACESSO-ADMINISTRATIVO.md](./ACESSO-ADMINISTRATIVO.md).

## Privacidade e retenção

Chamados podem conter dados pessoais escritos voluntariamente pela pessoa. Defina uma política de retenção antes da venda — por exemplo, apagar ou anonimizar chamados encerrados após o prazo necessário para atendimento e defesa legal. Essa decisão precisa constar na política de privacidade e deve ser revisada juridicamente.
