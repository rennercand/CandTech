# Roadmap do produto — CandTech

Este documento organiza as evoluções planejadas do produto. Ele não afirma que os itens abaixo já foram implementados e não substitui validação contábil, tributária, jurídica ou de segurança.

## Objetivo comercial

Posicionar a CandTech como uma plataforma simples para pequenas empresas que:

1. importa e organiza a movimentação financeira;
2. reduz trabalho manual com categorização assistida;
3. prevê caixa, contas e inadimplência;
4. explica o possível impacto da Reforma Tributária sobre preço, margem e recebimento.

A Reforma Tributária deve ser o diferencial que chama atenção. A organização financeira recorrente deve ser o motivo para o cliente continuar pagando.

## Ordem recomendada

| Prioridade | Entrega | Motivo |
| --- | --- | --- |
| 0 | Base de dados, multiempresa e auditoria | Evita construir novos módulos sobre um workspace difícil de auditar |
| 1 | CSV/OFX/XLSX, conciliação e duplicidades | Resolve trabalho frequente e tem alto valor comercial |
| 2 | IA de categorização com aprendizado | Economiza tempo e torna a demonstração do produto clara |
| 3 | Contas recorrentes, alertas e previsão de caixa | Cria uso semanal e mensal |
| 4 | Rastreamento de estoque e entregas | Conecta venda, produto, movimentação e entrega |
| 5 | Diagnóstico de IBS/CBS | Diferencial comercial oportuno |
| 6 | Simulador visual de split payment | Mostra o impacto no caixa sem executar recolhimento |
| 7 | Integrações fiscais e split payment real | Somente após validação técnica e regulatória |

O roadmap de proteção técnica está separado em [ROADMAP-SEGURANCA.md](./ROADMAP-SEGURANCA.md). Itens críticos daquele documento são bloqueadores para comercialização, mesmo quando não aparecem na ordem comercial acima.

## Fase 0 — Preparar a base

- atualizar README e arquitetura conforme as funções realmente existentes;
- separar o workspace em entidades: empresas, lançamentos, contas, produtos, estoque, pedidos, entregas, documentos fiscais e configurações tributárias;
- adicionar organizações e tenant_id;
- criar papéis de proprietário, administrador, financeiro, estoque, vendedor e leitura;
- registrar trilha de auditoria com autor, data, origem, valor anterior e valor novo;
- usar migrations versionadas em vez de criar ou alterar tabelas durante a inicialização;
- definir política de backup, restauração, retenção e exclusão.

## Fase 1 — Rotina financeira vendável

### Importação e conciliação

- aceitar PDF, CSV, OFX e XLSX;
- mostrar prévia antes de confirmar;
- detectar lançamentos duplicados;
- permitir desfazer uma importação inteira;
- informar linhas aceitas, ignoradas e duvidosas;
- conciliar lançamentos importados com contas, vendas e recebimentos;
- preparar integração futura com Open Finance.

### Contas a pagar e receber

- recorrência e parcelamento;
- pagamento parcial;
- juros, multa e desconto;
- comprovantes e anexos;
- alertas de vencimento;
- calendário financeiro;
- inadimplência;
- previsto versus realizado.

### Dashboard

- saldo atual por conta;
- entradas e saídas previstas para 7, 30 e 90 dias;
- contas vencidas e a vencer;
- receita, despesa, lucro e margem;
- mês atual versus mês anterior;
- produtos por faturamento e margem;
- alertas acionáveis em vez de apenas gráficos.

## Fase 2 — IA de categorização

### Fluxo inicial

1. Extrair data, descrição, valor e tipo.
2. Aplicar regras locais e o histórico privado da empresa.
3. Enviar à IA apenas descrições desconhecidas e os campos necessários.
4. Retornar categoria, subcategoria, estabelecimento, confiança e justificativa curta em formato estruturado.
5. Exigir revisão quando a confiança estiver baixa.
6. Aprender com correções confirmadas pelo usuário.

### Evoluções

- categorização em lote;
- despesas recorrentes e possíveis duplicidades;
- transferências entre contas próprias;
- gastos incomuns;
- sugestão de centro de custo;
- vínculo sugerido com cliente, fornecedor ou pedido;
- perguntas em linguagem natural;
- explicação de variações do caixa.

### Limites da IA

- nunca alterar valor, imposto ou registro contábil silenciosamente;
- registrar modelo, versão, confiança e origem;
- manter revisão humana;
- limitar uso mensal por empresa;
- usar cache para descrições repetidas;
- manter chaves apenas no servidor;
- revisar minimização de dados e LGPD.

## Fase 3 — Rastreamento e auditoria operacional

### Estoque

- livro de movimentações;
- entrada, saída, transferência, venda, ajuste e devolução;
- lote, validade, fornecedor e localização;
- motivo obrigatório para ajuste manual;
- custo médio e histórico por movimentação;
- curva ABC, estoque mínimo e itens parados.

### Entregas

- vínculo pedido → produto → estoque → entrega;
- etapas: criado, separado, despachado, em trânsito, entregue, devolvido ou cancelado;
- código de rastreio e integração futura com transportadoras;
- alertas de atraso;
- comprovante de entrega;
- custo e prazo médio de frete;
- página compartilhável sem dados financeiros.

### Módulo agro/EUDR opcional

Caso exista validação comercial específica:

- propriedades, fornecedores, lotes e origem geográfica;
- documentos e evidências;
- cadeia de custódia;
- vínculo entre lote recebido, produto vendido e exportação;
- alertas de documentação faltante.

Esse módulo deve permanecer separado do núcleo financeiro até existir demanda comprovada.

## Fase 4 — Diagnóstico da Reforma Tributária

Começar como simulador educativo e gerencial, não como apuração fiscal oficial.

### Cadastro

- regime e atividade econômica;
- estado e município;
- perfil do contribuinte;
- tipo de operação;
- classificação de produto ou serviço;
- tratamentos diferenciados, reduções, imunidades e alíquota zero.

### Resultado por operação

- base tributável;
- CBS;
- IBS estadual e municipal;
- reduções aplicáveis;
- crédito e débito estimados;
- valor bruto e líquido;
- memória do cálculo;
- versão e vigência da regra utilizada.

### Relatório de impacto

- comparação entre o modelo anterior e o novo;
- impacto em preço, margem e fluxo de caixa;
- compras com possível geração de crédito;
- projeção mensal e anual;
- relatório para discussão com o contador;
- distinção clara entre valor informativo e valor efetivamente recolhido.

As regras e alíquotas devem ser versionadas por data e mantidas fora do código de interface. Em 2026, o sistema deve tratar IBS/CBS como ambiente de teste conforme a orientação oficial e nunca apresentar a simulação como guia fiscal definitivo.

Fontes de acompanhamento: [Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo), [Lei Complementar nº 214/2025](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm) e [Lei Complementar nº 227/2026](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm).

## Fase 5 — Simulador de split payment

### Primeira versão: somente simulação

Exibir:

- valor pago pelo cliente;
- CBS e IBS estimados e segregados;
- créditos utilizados;
- valor líquido recebido;
- saldo tributário;
- diferença entre valor calculado e segregado;
- data e parcela da liquidação;
- comparação do caixa com e sem split.

Cobrir:

- pagamento integral;
- venda parcelada com segregação proporcional;
- pagamento parcial;
- cancelamento e devolução;
- antecipação de recebíveis;
- split padrão e simplificado;
- pagamento sem vínculo correto com documento;
- excesso segregado e devolução.

O motor deve ser determinístico, executado no servidor, versionado e coberto por testes de referência. A IA pode explicar o resultado, mas não decidir alíquota, crédito ou enquadramento.

### Split payment real

Só considerar depois de existirem:

- documento fiscal autorizado;
- classificação tributária confiável;
- vínculo pedido → nota → pagamento;
- integração com instituição de pagamento;
- conciliação de parcelas;
- regras atualizadas;
- tratamento de créditos, exceções e devoluções;
- validação contínua por contador ou especialista tributário;
- revisão jurídica da comunicação comercial.

## Fase 6 — Integrações e automação

- Pix Cobrança e Pix Automático;
- conciliação automática;
- documentos fiscais;
- integração com contador;
- webhooks para pedidos, pagamentos e entregas;
- exportação fiscal e contábil;
- API pública com escopos limitados;
- notificações por e-mail ou WhatsApp.

## Critério antes de construir o split real

Testar a versão financeira, a categorização e o diagnóstico tributário com 5 a 10 empresas e contadores. Medir:

- tempo economizado por mês;
- percentual de categorias aceitas sem correção;
- frequência de uso;
- retenção;
- dúvidas tributárias mais comuns;
- disposição real de pagamento;
- necessidade comprovada de integração fiscal.

Se o simulador gerar interesse, mas não retenção, melhorar primeiro a rotina financeira. Se houver demanda comprovada de contadores e empresas por conciliação fiscal, avançar gradualmente para integrações.
