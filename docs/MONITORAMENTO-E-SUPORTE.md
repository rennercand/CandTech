# Monitoramento privado e suporte

## Resultado

A CandTech possui uma central operacional com endereço não publicado. O administrador acessa pelo ERP em **Moderação → Abrir central privada de monitoramento**. A página é renderizada somente depois de validar a chave do caminho, o JWT, a sessão persistida e o e-mail do administrador. Uma chave incorreta ou uma conta que não esteja em `ADMIN_EMAILS` recebe uma página não encontrada; visitantes sem sessão são enviados ao login.

A sessão autenticada recebe apenas a decisão `administrator` e, somente quando ela for verdadeira, o caminho privado. Isso faz a aba aparecer sem depender da consulta de métricas. O botão da central continua disponível mesmo se essas métricas estiverem temporariamente indisponíveis e a configuração da assinatura não impede a administração operacional.

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

`ADMIN_EMAILS` é uma regra de autorização do servidor e não deve usar um e-mail compartilhado. `ADMIN_MONITORING_SLUG` é apenas uma camada adicional contra varreduras; JWT, sessão e autorização continuam sendo a segurança real. As duas variáveis `NEXT_PUBLIC_SUPPORT_*` são públicas porque aparecem propositalmente na aba Suporte.

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
4. O administrador lê a mensagem na seção **Mensagens** da central privada.
5. A resposta é salva no chamado e aparece para a pessoa na aba Suporte, atualizada a cada 30 segundos. A preferência por e-mail ou telefone orienta um contato manual; a cópia no sistema permanece como histórico.

Cada usuário consulta somente os próprios chamados. O administrador autorizado pode consultar todos para realizar o atendimento. Não se deve pedir senha, chave, número completo de cartão ou documento pessoal no formulário.

## Estados

Incidentes: `open`, `investigating`, `resolved`.

Chamados: `open`, `answered`, `closed`.

## Banco e migração

A inicialização cria as tabelas tanto no PostgreSQL/Neon quanto no SQLite local. Para ambientes em que migrations são aplicadas separadamente, execute `migrations/20260811_monitoring_and_support.sql` antes do deploy.

## Verificação antes de publicar

1. Confirmar `ADMIN_EMAILS` na Vercel sem espaços ou erros de digitação.
2. Entrar com o administrador, abrir **Moderação** e usar o botão da central privada.
   Se a sessão já estava aberta quando `ADMIN_EMAILS` foi alterado, sair e entrar novamente ou atualizar a página para renovar os dados da interface.
3. Confirmar que outra conta recebe acesso negado.
4. Enviar uma mensagem de teste pela aba Suporte e responder pela central.
5. Confirmar que a resposta aparece somente na conta que enviou o chamado.
6. Rodar `npm test` e `npm run build`.

## Privacidade e retenção

Chamados podem conter dados pessoais escritos voluntariamente pela pessoa. Defina uma política de retenção antes da venda — por exemplo, apagar ou anonimizar chamados encerrados após o prazo necessário para atendimento e defesa legal. Essa decisão precisa constar na política de privacidade e deve ser revisada juridicamente.
