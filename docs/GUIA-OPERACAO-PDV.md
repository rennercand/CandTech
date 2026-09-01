# Guia de operação — PDV e pedidos

## Venda rápida

1. Abra **Pedidos e vendas**.
2. Leia o código com o leitor ou digite o SKU/EAN e pressione `Enter`. O leitor comum funciona como teclado; cadastre o EAN no campo SKU.
3. Selecione um cliente cadastrado ou informe o nome do cliente avulso.
4. Confira quantidades e preços.
5. Escolha a forma de recebimento. **A prazo / pendente** exige o vencimento; as demais formas entram no caixa na data da venda.
6. Se o cargo possuir **Conceder descontos**, informe o valor autorizado.
7. Confirme uma única vez.

## Efeito da confirmação

- baixa os produtos por FEFO e impede saldo negativo;
- grava pedido, itens e margem comercial;
- cria a entrega em preparação;
- para dinheiro, Pix, cartão, transferência ou outro recebimento imediato, cria entrada no **Caixa principal**;
- para venda a prazo, cria uma conta a receber ligada ao pedido;
- publica eventos internos com chave idempotente.
- registra na auditoria quem criou, importou, vendeu, comprou ou desfez a operação.

Se qualquer parte falhar, nada é confirmado.

## Desfazer ou cancelar

Abra **Movimentações**, localize o lote da venda e use **Desfazer**. O sistema preserva o histórico e:

- devolve os produtos aos mesmos lotes;
- cancela o pedido e a entrega;
- cancela a conta a receber pendente; ou
- se o valor já entrou no caixa, cria uma saída de estorno do mesmo valor.

Não apague manualmente uma entrada financeira para simular cancelamento: use o desfazimento da operação original.

## Permissões

**Pedidos e vendas** permite operar o PDV. **Conceder descontos** é independente e deve ficar somente com proprietários, gerentes ou cargos autorizados. O proprietário sempre possui ambas.

## Conferência antes de vender

Faça três testes com um SKU de saldo conhecido:

1. venda por Pix e confirme a baixa no estoque e a entrada no caixa;
2. venda a prazo e confirme a conta a receber e o vencimento;
3. desfaça ambas e confirme estoque restaurado, conta cancelada e lançamento de estorno.
