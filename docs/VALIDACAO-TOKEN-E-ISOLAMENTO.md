# Validação de token e isolamento

## Escopo e reprodução

Execute `node --test test/token-authorization.test.js` (Node.js 24, como no ambiente validado). A suíte usa seis usuários sintéticos, três organizações e SQLite temporário. Executa as funções reais de autenticação, autorização e os handlers de exclusão de histórico e leitura de equipe, sem mocks dessas camadas. Não inicia servidor HTTP e não usa Neon ou contas de clientes.

## Contrato conferido

- JWT assinado com HS256, com `sub`, `jti`, `iat` e `exp` obrigatórios e idade máxima de oito horas.
- `sub` identifica o usuário; `jti` identifica uma sessão cujo hash está no banco. A sessão precisa estar ativa, não revogada, não expirada e vinculada ao mesmo usuário.
- Nome, e-mail, tipo da conta, situação da assinatura e estado de MFA usados pela aplicação são obtidos do servidor, não aceitos como autoridade de claims de perfil.
- O servidor resolve organização, proprietário e permissões atuais. Colaboradores podem acessar dados compartilhados da própria empresa conforme suas permissões; não ficam limitados a documentos que eles mesmos criaram.
- Consulta de histórico combina identificador do documento, proprietário e organização, além da permissão de histórico e do tipo do documento.
- Gestão de equipe exige proprietário e MFA verificado. Uma sessão autenticada comum não basta para essa ação.

## Cenários automatizados

- Seis identidades e 18 combinações de usuário/documento, incluindo acesso autorizado de funcionários à própria empresa e negativa entre empresas.
- Cookie ausente, token malformado, token sem assinatura, chave errada, HS384, payload adulterado, identidade trocada e sessão inexistente.
- JWT expirado ou sem cada claim obrigatório, revogação de sessão e expiração independente no banco.
- Alteração de perfil e MFA no JWT sem elevação efetiva de privilégios.
- Retirada de permissão e suspensão do colaborador, usando o mesmo token anteriormente emitido.
- E-mail não verificado e assinatura inativa bloqueados; exceção explícita de assinatura preservada para o fluxo de regularização.
- Exclusão sem sessão retorna 401; seis tentativas de exclusão entre empresas retornam 404 e preservam os documentos.
- Gestão da equipe negada a funcionário e a proprietário sem MFA.

## Endurecimento realizado

A sessão no banco já tinha expiração. A validação JWT agora também exige explicitamente emissão e expiração: antes um JWT corretamente assinado sem `exp` ainda era aceito enquanto a sessão estivesse ativa. Isso não permitia a um cliente remover `exp` sem invalidar a assinatura. A mudança reforça o contrato e rejeita formatos incompletos, mantendo compatibilidade com os tokens normalmente emitidos pelo aplicativo.

## Limitações e próximas verificações

Não é pentest nem validação de todas as entidades e rotas. Ainda faltam testes HTTP ponta a ponta em Preview, concorrência real no PostgreSQL, restauração completa de Neon/Blob e revisão independente. Os testes de interface existentes não substituem navegação real.

O JWT é uma credencial de sessão: alguém que roube o cookie válido pode representar seu titular até expiração ou revogação. O conteúdo é assinado, não cifrado; não deve conter segredos. HttpOnly, Secure em produção e SameSite reduzem riscos, mas não tornam roubo de sessão impossível. A exigência de MFA depende da ação protegida, não deve ser anunciada como reautenticação para toda requisição.

Alterações locais só entram em produção após publicação e verificação do deployment.

## Ampliação: API e HTTP compilado

Minimização adicional: novos JWTs contêm apenas `sub`, `jti`, `iat` e `exp`. Nome, e-mail e tipo de conta continuam disponíveis pela sessão resolvida no servidor, sem duplicação no cookie. Tokens anteriores permanecem compatíveis até expiração/revogação. Testes conferem o conteúdo dos tokens, a compatibilidade e a negativa de conta suspensa, inclusive quando a rota permite regularizar assinatura ou e-mail. Os identificadores restantes continuam sendo dados vinculáveis à conta, não dados anônimos.

A suíte de handlers também verifica workspace com proprietário/organização forjados no corpo, filtragem de campos financeiros de funcionários, acesso anônimo, áreas sem permissão, CSRF, conteúdo inválido, excesso de bytes, JSON malformado, prototype pollution, alteração de alerta de outro tenant e replay/conflito de idempotência.

Depois de `npm run build`, execute `npm run test:security:http` em checkout sem arquivos `.env`. O script cria um SQLite temporário e três usuários, inicia o Next.js compilado somente no loopback, executa 39 verificações HTTP e encerra o processo. Não herda credenciais de serviços externos. Testa 401 para anônimos, `no-store`, `nosniff`, leitura de histórico próprio, exclusão cruzada, CSRF, exigência de MFA e revogação. Este passo foi incluído no CI após o build; execução local aprovada, execução remota ainda depende de publicação.

Esses testes HTTP são locais, não testes de carga nem validação do Neon, Blob ou da configuração da Vercel.
