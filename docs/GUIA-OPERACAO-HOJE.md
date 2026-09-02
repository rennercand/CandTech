# Guia de operação — Hoje

## Como priorizar

A primeira tela do ERP reúne somente informações das áreas liberadas para o seu cargo:

- vendas e margem estimada do dia;
- contas a receber ou pagar vencidas e com vencimento hoje;
- itens abaixo do estoque mínimo e lotes vencidos ou próximos da validade;
- ordens de serviço agendadas para hoje, atrasadas ou concluídas sem cobrança;
- conferência do saldo do Caixa principal.

Selecione um cartão ou o botão do alerta para abrir diretamente o módulo onde a situação pode ser resolvida. A tela não altera pedidos, contas ou serviços automaticamente.

## Conferir o caixa

1. Confira o saldo disponível no caixa ou conta operacional representada por **Caixa principal**.
2. Compare com o valor **Esperado agora**, calculado a partir dos lançamentos realizados.
3. Informe o **Saldo contado** e, se necessário, uma observação curta.
4. Selecione **Conferir caixa**.

Cada conferência é acrescentada ao histórico com data, saldo esperado, contado, diferença e autor. O valor anterior não é apagado.

Diferença positiva significa que o contado ficou acima do livro; diferença negativa significa que ficou abaixo. Antes de criar um ajuste, revise vendas recebidas, pagamentos, retiradas e estornos. A conferência não cria um lançamento financeiro silenciosamente.

## Permissões

- pedidos e margem aparecem somente para quem pode acessar **Pedidos e vendas**;
- estoque e validade aparecem somente para quem pode acessar **Logística e estoque**;
- serviços aparecem somente para quem pode acessar **Ordens de serviço**;
- vencimentos e conferência de caixa aparecem somente para quem pode acessar **Movimentações**.

O servidor aplica os mesmos filtros mesmo que alguém tente chamar a API diretamente.
