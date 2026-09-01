# Guia de operação do estoque — CandTech

Este guia serve para capacitar proprietários, gerentes e funcionários. A tela **Estoque e logística** também contém uma versão resumida em **Como operar**.

## Regra principal

O SKU identifica uma variação específica. A quantidade muda somente por entrada, compra, venda ou desfazimento. Não recrie um produto para corrigir o saldo.

| Produto | Variação | SKU |
| --- | --- | --- |
| Pelúcia | Cachorro · P | `PELUC-001` |
| Pelúcia | Gato · P | `PELUC-002` |
| Celular | Preto · 128 GB | `CEL-PT-128` |

## Treinamento em 20 minutos

1. Mostre **Visão geral** e explique produtos, SKUs, unidades, valor pelo custo e alertas.
2. Em **Produtos e variações**, cadastre um produto de teste e gere duas variações.
3. Em **Entrada rápida**, receba duas variações na mesma operação.
4. Em **Pedidos**, conclua uma venda com dois produtos e confira a redução do saldo.
5. Em **Movimentações**, desfaça a venda de teste e confira a restauração do saldo.
6. Em **Importar planilha**, mostre a diferença entre cadastrar produtos e dar entrada em SKUs existentes.
7. Em **Visão geral**, mostre o gráfico por categoria e baixe um relatório de teste.

## Rotina diária

### Produto novo

1. Abra **Produtos e variações**.
2. Informe produto, categoria e unidade.
3. Crie um SKU único para cada cor, modelo, sabor, tamanho ou armazenamento.
4. Revise custo, preço, mínimo e localização.
5. Confirme o cadastro. O formulário só é limpo depois de o servidor confirmar.

### Mercadoria recebida

1. Abra **Entrada rápida**.
2. Informe fornecedor e referência da nota ou compra.
3. Adicione todos os itens recebidos.
4. Para alimentos, informe lote e validade.
5. Confira e confirme uma única vez.

### Venda ou compra

1. Abra **Pedidos**.
2. Selecione venda ou compra, referência e parceiro.
3. Adicione todos os produtos e quantidades.
4. Confira o total.
5. Conclua. Venda reduz o saldo; compra aumenta.

### Estoque inicial por planilha

1. Abra **Importar planilha**, escolha **Cadastrar produtos novos** e baixe o modelo.
2. Preserve os cabeçalhos obrigatórios `Produto`, `SKU` e `Quantidade`.
3. Use uma linha para cada variação.
4. Envie CSV, TSV, TXT ou XLSX, ou cole linhas copiadas do Excel.
5. Corrija todos os erros apresentados na prévia.
6. Confirme somente depois de conferir a quantidade de SKUs.

### Entrada de muitas mercadorias por planilha

1. Abra **Importar planilha** e escolha **Dar entrada em SKUs existentes**.
2. Na coluna `Quantidade`, informe somente o que chegou agora — nunca o saldo total da loja.
3. O SKU já deve existir. SKU desconhecido é recusado antes de qualquer gravação.
4. Informe fornecedor, referência, custo, lote e validade quando aplicáveis.
5. Confira a prévia e confirme. A quantidade é somada ao saldo e a operação fica disponível em **Movimentações**.

### Relatórios e Google Drive

Na **Visão geral**, usuários com permissão de exportação podem baixar CSV ou Excel. O CSV usa as mesmas colunas do importador; ao reutilizá-lo para uma entrada, substitua a quantidade atual pela quantidade recebida. O Excel inclui resumo, produtos, pedidos, lotes e validades. Usuários com permissões de exportação e Drive também podem enviar esse Excel à própria conta Google conectada.

### Corrigir erro

Abra **Movimentações** e use **Desfazer**. A CandTech cria uma movimentação inversa e preserva o registro original. O desfazimento é recusado quando produziria estoque negativo por causa de operações posteriores.

## Permissões e responsabilidade

- Proprietário: acesso integral, equipe e decisões de configuração.
- Gerente: áreas explicitamente autorizadas pelo proprietário.
- Colaborador com permissão de estoque: cadastro, entrada, importação e desfazimento.
- Colaborador com permissão comercial: pedidos de compra e venda.

Todas as APIs exigem sessão JWT e resolvem a empresa pelo acesso atual do usuário. IDs enviados pelo navegador não definem o proprietário dos dados.

## Conferência semanal

- revisar alertas de estoque mínimo;
- conferir o gráfico de valor por categoria para identificar dinheiro concentrado ou mercadoria parada;
- conferir operações desfeitas e referências sem identificação;
- verificar lotes próximos da validade quando usados;
- comparar compras recebidas com entradas registradas;
- revisar SKUs duplicados ou cadastros criados como “cópia” ainda não ajustados.

## Limites desta entrega

- lotes e validades possuem saldo próprio; na venda, o sistema baixa primeiro o lote com validade mais próxima (FEFO) e deixa os lotes sem validade por último;
- a Visão geral usa o histórico confirmado para mostrar custo médio ponderado, curva ABC por faturamento, itens há 90 dias sem venda e sugestão de reposição até o mínimo cadastrado;
- não existe integração fiscal oficial nem leitura automática de nota;
- a entrada em massa atualiza quantidade e custo de SKUs existentes, mas alterações em massa de nome, preço, mínimo e localização ainda exigem um fluxo próprio futuro;
- o saldo é protegido por transação, mas testes de carga e restauração de backup continuam obrigatórios antes da venda empresarial ampla.
