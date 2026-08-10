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
6. Em **Importar planilha**, baixe o modelo e mostre a prévia sem confirmar.

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

1. Abra **Importar planilha** e baixe o modelo.
2. Preserve os cabeçalhos obrigatórios `Produto`, `SKU` e `Quantidade`.
3. Use uma linha para cada variação.
4. Envie CSV, TSV, TXT ou XLSX, ou cole linhas copiadas do Excel.
5. Corrija todos os erros apresentados na prévia.
6. Confirme somente depois de conferir a quantidade de SKUs.

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
- conferir operações desfeitas e referências sem identificação;
- verificar lotes próximos da validade quando usados;
- comparar compras recebidas com entradas registradas;
- revisar SKUs duplicados ou cadastros criados como “cópia” ainda não ajustados.

## Limites desta entrega

- lotes e validades recebidos possuem consulta própria, mas a baixa automática por lote/FEFO ainda não está implementada;
- não existe integração fiscal oficial nem leitura automática de nota;
- importações criam produtos novos e recusam SKU já existente; atualização em massa exige fluxo próprio futuro;
- o saldo é protegido por transação, mas testes de carga e restauração de backup continuam obrigatórios antes da venda empresarial ampla.
