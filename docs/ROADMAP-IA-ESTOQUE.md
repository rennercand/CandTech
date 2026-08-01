# Ressalva: IA para extratos e futura aba de estoque

Este documento registra uma possibilidade de evolução do produto. A funcionalidade ainda não foi implementada e nenhuma API de IA foi contratada ou ativada.

## Categorização de lançamentos bancários

O fluxo recomendado combina regras locais e IA:

1. O leitor atual extrai data, descrição e valor do PDF no navegador.
2. Um dicionário local classifica estabelecimentos já conhecidos.
3. Somente descrições desconhecidas são enviadas à API de IA.
4. A resposta deve conter categoria, subcategoria e nível de confiança em formato estruturado.
5. Resultados com baixa confiança ficam marcados para revisão humana.
6. Correções do usuário alimentam o dicionário privado da própria conta.

A IA deve interpretar os lançamentos, mas não deve efetuar cálculos financeiros ou lançamentos contábeis definitivos sem validação. A chave da API deverá existir apenas no servidor e nas variáveis protegidas da Vercel, nunca no navegador ou no repositório.

## Futura aba de estoque

A primeira versão poderá incluir:

- produtos, SKU, categoria e unidade de medida;
- quantidade atual, estoque mínimo e alertas de reposição;
- entradas, saídas e histórico de movimentações;
- custo unitário, custo médio, preço de venda e valor armazenado;
- importação por CSV, Excel ou cadastro manual;
- curva ABC e identificação de itens sem movimentação.

Posteriormente, a IA poderá sugerir categorias, padronizar nomes, detectar possíveis duplicidades e auxiliar na leitura de documentos. Quantidade, custo médio e saldo continuarão sendo calculados deterministicamente pelo sistema.

## Controle de custo e segurança

- usar primeiro regras locais e cache para evitar chamadas repetidas;
- enviar somente os campos necessários, minimizando dados pessoais;
- impor limite mensal de uso por conta;
- registrar modelo, data e confiança de cada classificação;
- permitir correção manual e nunca ocultar que a categoria foi sugerida;
- revisar privacidade e LGPD antes de utilizar dados empresariais reais.
