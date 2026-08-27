# Acesso administrativo e equipe interna

## Papéis disponíveis

| Permissão | Pode fazer | Não pode fazer |
| --- | --- | --- |
| Monitoramento | Ver e atualizar incidentes e métricas agregadas | Ler chamados, abrir comprovantes ou liberar assinaturas |
| Suporte | Ler, responder e encerrar chamados | Ver pagamentos, comprovantes ou gerenciar equipe |
| Cobrança | Ver cobranças e comprovantes, aprovar ou rejeitar Pix | Ler chamados ou gerenciar equipe |
| Administrador principal | Todos os módulos e gestão da equipe interna | Não deve compartilhar conta ou senha |

O administrador principal é configurado em `ADMIN_EMAILS` na Vercel. Essa raiz de confiança não é alterável pelo painel. Contas internas persistidas nunca recebem `canManageStaff`, mesmo que uma requisição seja adulterada.

## Como entrar na central

1. Entre normalmente em `https://www.candtech.com.br` com sua conta administrativa verificada.
2. No menu lateral, abra **Moderação** e clique em **Abrir central privada**.
3. Se a conta interna não possui assinatura do ERP, a própria tela inicial mostra **Abrir central privada**; ela não libera os módulos financeiros pagos.
4. O servidor entrega o endereço secreto somente depois de validar JWT, sessão ativa, e-mail verificado e permissão atual.

Não salve nem distribua o endereço da central. Conhecer a URL não substitui o login e não concede acesso.

## Como criar o login de uma pessoa da equipe

1. Peça para a própria pessoa abrir a CandTech e clicar em **Criar conta**.
2. Ela informa o próprio nome, e-mail individual e uma senha que somente ela conhece.
3. Ela aceita os documentos e confirma o e-mail recebido.
4. O administrador principal entra em **Moderação → Abrir central privada → Equipe interna**.
5. Digita exatamente o mesmo e-mail da conta.
6. Seleciona uma ou mais permissões e clica em **Conceder ou atualizar**.
7. A pessoa atualiza a página ou entra novamente. Com assinatura ativa, **Moderação** aparece no ERP; sem assinatura, aparece uma entrada operacional limitada para a central.

Não crie senhas para funcionários e não use um e-mail compartilhado. Se a pessoa esquecer a senha, ela deve usar **Esqueci minha senha**. Isso mantém tokens, auditoria e revogação vinculados a uma identidade individual.

## Para quem libera clientes depois do Pix

Conceda somente **Cobrança**. Essa pessoa poderá abrir o comprovante e clicar em **Confirmar recebimento**, mas apenas depois de localizar o Pix na conta bancária. O upload do cliente não libera o ERP automaticamente.

## Para quem responde chamados

Conceda somente **Suporte**. Essa pessoa verá a aba **Mensagens**, poderá responder e encerrar chamados, mas não verá comprovantes nem botões de aprovação.

Se uma pessoa exercer as duas funções, marque **Suporte** e **Cobrança**. Evite conceder **Monitoramento** sem necessidade operacional.

## Revogar ou alterar

- Em **Equipe interna**, use **Editar** para mudar os módulos.
- Use **Revogar acesso** para remover todos os privilégios internos.
- A revogação vale na próxima requisição, mesmo que a sessão continue aberta.
- A pessoa mantém sua conta comum, mas deixa de acessar a central.

Concessões, mudanças e revogações geram eventos de auditoria com o identificador do administrador responsável e as permissões, sem registrar senhas.

## Preparação de produção

1. carregue a `DATABASE_URL` de Preview e depois de Production e execute `npm run migrate:2026-08-26` em cada ambiente;
2. mantenha em `ADMIN_EMAILS` apenas contas individuais dos responsáveis principais;
3. teste uma conta com Suporte, uma com Cobrança e uma sem acesso;
4. tente chamar diretamente as APIs de outro módulo e confirme `403`;
5. revogue uma conta e confirme que o acesso desaparece imediatamente na próxima chamada;
6. registre quem pode aprovar pagamentos e faça revisão periódica dos acessos.
