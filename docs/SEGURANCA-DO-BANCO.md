# Segurança e policies do banco

## Resposta objetiva

O código e as migrations atuais não criam PostgreSQL Row Level Security (RLS): não existem comandos `ENABLE ROW LEVEL SECURITY` nem `CREATE POLICY` versionados no repositório. Portanto, não se deve anunciar que o Neon está protegido por RLS sem consultar também o catálogo do ambiente de produção.

Ativar RLS agora, sem adaptação, pode bloquear o próprio servidor. A aplicação usa uma conexão de servidor compartilhada e ainda não define em cada transação uma identidade PostgreSQL de usuário/tenant que as policies possam consultar.

## Regras de acesso existentes na aplicação

- JWT assinado em cookie `HttpOnly`, sessão persistida, expiração absoluta e revogação;
- e-mail normalizado e índice único para impedir novas contas duplicadas;
- usuário e organização são derivados da sessão, não de um ID escolhido no navegador;
- consultas de documentos combinam UUID público aleatório com proprietário autorizado;
- estoque, equipe e convites usam tenant e permissões resolvidos no servidor;
- rotas privadas exigem autenticação; alterações validam origem, tipo e tamanho;
- SQL usa parâmetros, evitando concatenar entrada do usuário nas consultas;
- central administrativa exige caminho privado, sessão válida, e-mail verificado, aceite jurídico e permissão atual; somente a raiz `ADMIN_EMAILS` gerencia a equipe;
- suporte, monitoramento e cobrança são permissões independentes, verificadas novamente no servidor a cada requisição;
- rate limit compartilhado no banco e trilha de auditoria para operações críticas;
- segredos ficam em variáveis de ambiente sem prefixo `NEXT_PUBLIC_`.

Essas regras são importantes, mas são controles da aplicação. Elas não substituem uma segunda barreira no próprio PostgreSQL.

## Como verificar o Neon ao vivo

Execute no SQL Editor da branch de produção:

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Se a segunda consulta não retornar linhas, não há policies no schema público. A primeira mostra quais tabelas têm RLS habilitado.

## Caminho recomendado para RLS

1. terminar a adoção consistente de `tenant_id` nas tabelas empresariais;
2. definir contexto de tenant no servidor dentro de transações;
3. criar policies `USING` e `WITH CHECK` por tabela;
4. usar uma role de aplicação que não ignore RLS;
5. testar leitura e escrita cruzadas entre dois tenants, administrador, funcionário e proprietário;
6. aplicar primeiro em uma branch Neon de preview e manter rollback documentado.

Até essa etapa ser concluída, a CandTech deve descrever sua proteção como isolamento aplicado pelo servidor, não como RLS do Neon.
