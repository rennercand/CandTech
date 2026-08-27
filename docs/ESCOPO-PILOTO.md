# Escopo comercial do piloto

Este documento impede que ideias futuras sejam confundidas com a versão vendável atual.

## Essencial para vender o piloto

- autenticação, confirmação de e-mail e recuperação de senha;
- separação por empresa, cargos e permissões existentes;
- visão geral, clientes, tarefas, financeiro, pedidos e estoque;
- importação e exportação já disponíveis;
- histórico, relatórios e integração Google Drive com `drive.file`;
- plano único, Pix manual, comprovante privado e aprovação humana;
- suporte, monitoramento, termos e políticas visíveis.

## Infraestrutura necessária

- Neon separado entre Production e Preview;
- Vercel Blob privado separado entre Production e Preview;
- migrations versionadas, CI, logs estruturados e auditoria;
- Resend configurado para verificação, recuperação, convites e backups;
- procedimento de backup/restauração e resposta a incidente.

## Experimental, sem promessa comercial

- importação de PDF bancário e sugestões determinísticas que ainda exigem revisão;
- novos relatórios ou automações em validação;
- melhorias de conciliação sem integração bancária oficial.

## Fora do piloto / futuro

- IA, Open Finance automático, emissão fiscal oficial, split payment real, aplicativo móvel nativo, SSO/SAML e API pública geral;
- qualquer função descrita apenas em `ROADMAP-PRODUTO.md`.

## Jornada simples de demonstração

1. criar e verificar a conta empresarial;
2. mostrar a visão geral e cadastrar um cliente;
3. criar tarefa ou pedido e movimentar um item de estoque;
4. registrar uma conta e observar o impacto financeiro;
5. salvar um documento e exportar com nome escolhido;
6. conectar o Drive e enviar um arquivo;
7. mostrar cargos/permissões sem expor credenciais;
8. gerar Pix, enviar comprovante e explicar a conferência administrativa.

## Regra de decisão para novas funções

Uma solicitação entra no piloto somente quando resolve um problema recorrente do ICP, cabe na operação de suporte atual, não aumenta risco fiscal/financeiro sem validação e possui teste, documentação e critério de conclusão. Caso contrário, vai para o roadmap.
