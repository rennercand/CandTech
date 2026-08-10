# Roadmap do produto — CandTech

Este documento organiza as evoluções planejadas do produto. Ele não afirma que os itens abaixo já foram implementados e não substitui validação contábil, tributária, jurídica ou de segurança.

## Objetivo comercial

Posicionar a CandTech como uma plataforma simples para pequenas empresas que:

1. importa e organiza a movimentação financeira;
2. reduz trabalho manual com regras, conciliação e automações determinísticas;
3. prevê caixa, contas e inadimplência;
4. explica o possível impacto da Reforma Tributária sobre preço, margem e recebimento.

A Reforma Tributária deve ser o diferencial que chama atenção. A organização financeira recorrente deve ser o motivo para o cliente continuar pagando.

## Ordem recomendada

| Prioridade | Entrega | Motivo |
| --- | --- | --- |
| 0 | Base de dados, multiempresa e auditoria | Evita construir novos módulos sobre um workspace difícil de auditar |
| 1 | CSV/OFX/XLSX, conciliação e duplicidades | Resolve trabalho frequente e tem alto valor comercial |
| 2 | Regras de categorização e conciliação avançada | Economiza tempo sem depender de serviço externo de IA |
| 3 | Contas recorrentes, alertas e previsão de caixa | Cria uso semanal e mensal |
| 4 | Rastreamento de estoque e entregas | Conecta venda, produto, movimentação e entrega |
| 5 | Diagnóstico de IBS/CBS | Diferencial comercial oportuno |
| 6 | Simulador visual de split payment | Mostra o impacto no caixa sem executar recolhimento |
| 7 | Integrações fiscais e split payment real | Somente após validação técnica e regulatória |

O roadmap de proteção técnica está separado em [ROADMAP-SEGURANCA.md](./ROADMAP-SEGURANCA.md). Itens críticos daquele documento são bloqueadores para comercialização, mesmo quando não aparecem na ordem comercial acima.

## Decisão atual — o que implementar agora

**Decisão explícita:** não habilitar emissão oficial de NF-e/NFC-e em produção nesta etapa. A melhor sequência para a CandTech agora é consolidar segurança, multiempresa, auditoria e conciliação financeira. A emissão fiscal deve ser preparada no modelo de dados e validada em homologação, mas só poderá ser oferecida como funcionalidade oficial depois dos critérios abaixo.

| Momento | Implementar | Não apresentar como pronto |
| --- | --- | --- |
| Agora | Correções P0/P1 de segurança, isolamento por `tenant_id`, papéis, auditoria, migrations, backup e ambientes separados | Segurança empresarial ou isolamento completo enquanto os testes de acesso cruzado não passarem |
| Agora | Importação CSV/OFX/XLSX/PDF, detecção de duplicidade, conciliação e rascunhos editáveis | Integração bancária automática sem consentimento, idempotência e revisão humana |
| Agora | Pedidos, estoque, contas e pré-nota PDF; preparar campos fiscais no cadastro de empresa, cliente e produto | Chamar a pré-nota de NF-e, NFC-e, DANFE ou documento fiscal |
| Próximo experimento | Prova de conceito com um provedor fiscal no ambiente de homologação e acompanhada por contador | Emissão em produção ou armazenamento definitivo de certificado de clientes |
| Depois da validação | Emissão oficial via provedor, com XML, protocolo, DANFE, eventos e auditoria | Integração direta com múltiplas SEFAZ antes de haver volume e equipe para mantê-la |

### Por que esta é a melhor ordem

1. Uma falha em conciliação pode ser corrigida; uma falha de isolamento, certificado ou numeração fiscal pode expor clientes ou gerar obrigação fiscal incorreta.
2. A conciliação e a organização financeira entregam valor recorrente mais cedo e validam se empresas realmente usam e pagam pelo produto.
3. Pedidos, clientes, produtos, estoque e pagamentos são a matéria-prima da nota; melhorar esses cadastros reduz retrabalho na integração fiscal.
4. Um provedor especializado reduz inicialmente a manutenção de regras estaduais, schemas, notas técnicas, contingência e Web Services.
5. A integração direta com a SEFAZ só deve ser reconsiderada quando custo por nota, volume e controle operacional justificarem a complexidade.

### Preparação fiscal permitida agora

- criar entidades de documento fiscal, item fiscal e evento fiscal, todas vinculadas ao `tenant_id`;
- acrescentar ao produto NCM, CEST quando aplicável, origem, unidade comercial e dados tributários revisados pelo contador;
- acrescentar à empresa CNPJ, inscrição estadual, regime tributário, endereço fiscal, série e ambiente;
- acrescentar ao cliente CPF/CNPJ, indicador de inscrição estadual, endereço e e-mail;
- definir uma interface interna de provedor para evitar acoplar pedidos a uma única empresa de emissão;
- criar estados `rascunho`, `validando`, `enviando`, `autorizada`, `rejeitada`, `cancelada` e `contingência`;
- validar o fluxo apenas em homologação, com dados e certificado próprios para teste;
- manter o botão atual como **Pré-nota PDF — sem validade fiscal**.

### Condições para liberar emissão oficial

- todos os itens P0 e P1 aplicáveis da roadmap de segurança concluídos;
- teste automatizado de isolamento entre empresas e permissões de emissão/cancelamento;
- segredos e certificados criptografados, não reveláveis e nunca enviados ao navegador;
- migrations, backup e restauração testados;
- idempotência comprovada para clique repetido, timeout e repetição de webhook;
- homologação concluída com autorização, rejeição, cancelamento, inutilização e contingência;
- validação do cadastro e da regra tributária por contador responsável;
- piloto controlado com poucas empresas antes da liberação geral;
- termos, suporte, monitoramento e plano de incidente definidos.

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
- integrar uma instituição/agregador autorizado de Open Finance somente com consentimento explícito da empresa;
- importar movimentações bancárias e Pix por identificador estável, com idempotência, revogação do consentimento e trilha de auditoria;
- sugerir venda para recebimentos e compra para pagamentos, mantendo confirmação e edição manual para transferências internas, impostos, estornos e outras exceções.

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

## Fase 2 — Categorização por regras e conciliação avançada

A integração com inteligência artificial foi retirada do escopo atual. Esta fase deve usar apenas regras verificáveis, histórico confirmado pela empresa e revisão humana.

### Fluxo inicial

1. Extrair data, descrição, valor e tipo.
2. Aplicar regras locais e o histórico privado da empresa.
3. Aplicar regras privadas configuradas pela empresa para descrições desconhecidas.
4. Sugerir categoria, subcategoria e estabelecimento com a regra utilizada visível.
5. Exigir revisão quando nenhuma regra confiável for encontrada.
6. Aprender com correções confirmadas pelo usuário.

### Evoluções

- categorização em lote;
- despesas recorrentes e possíveis duplicidades;
- transferências entre contas próprias;
- gastos incomuns;
- sugestão de centro de custo;
- vínculo sugerido com cliente, fornecedor ou pedido;
- filtros salvos para consultas recorrentes;
- explicação determinística de variações do caixa.

### Limites da automação

- nunca alterar valor, imposto ou registro contábil silenciosamente;
- registrar regra, versão, confiança e origem;
- manter revisão humana;
- impedir que uma regra nova reclassifique silenciosamente lançamentos já confirmados;
- manter histórico das regras aplicadas;
- revisar minimização de dados e LGPD.

## Fase 3 — Rastreamento e auditoria operacional

### Estoque

**Entregue na branch `test` em 9 de agosto de 2026:** base relacional por empresa, produtos e variações com SKU, entrada em lote, importação CSV/TSV/TXT/XLSX com prévia, pedidos multi-item, livro de movimentações e reversão auditável. Lote e validade são capturados e consultáveis; baixa automática por lote/FEFO, custo médio histórico e curva ABC continuam pendentes.

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

O motor deve ser determinístico, executado no servidor, versionado e coberto por testes de referência. Nenhuma automação pode decidir livremente alíquota, crédito ou enquadramento.

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
- emissão fiscal oficial por provedor/SEFAZ: gerar XML assinado, transmitir para autorização, guardar protocolo e somente então produzir o DANFE correspondente;
- integração com contador;
- webhooks para pedidos, pagamentos e entregas;
- exportação fiscal e contábil;
- API pública com escopos limitados;
- notificações por e-mail ou WhatsApp.

### Emissão fiscal diretamente pela CandTech

É possível permitir que o usuário emita a nota dentro do próprio site. Para o usuário, a experiência pode ser um botão **Emitir nota fiscal** no pedido; tecnicamente, a autorização sempre deve ocorrer no servidor, por integração com um provedor fiscal ou com os Web Services da SEFAZ. O PDF sozinho não é uma nota fiscal válida.

#### Escopo e documentos

- NF-e modelo 55 para circulação de produtos e mercadorias;
- NFC-e modelo 65 para venda presencial ao consumidor, conforme as regras da UF;
- NFS-e para serviços, tratada como integração separada porque possui regras e canais diferentes;
- manter a pré-nota atual apenas como documento comercial de conferência, sempre marcada como sem validade fiscal.

#### Estratégia recomendada

1. Começar com um provedor fiscal especializado, mantendo a emissão dentro da interface CandTech.
2. Usar primeiro o ambiente de homologação, cujos documentos não possuem validade fiscal.
3. Validar o fluxo com contador e empresas piloto antes de habilitar produção.
4. Considerar integração direta com cada SEFAZ somente quando o volume e o custo justificarem a manutenção dos schemas, notas técnicas, regras estaduais e contingências.

#### Requisitos da empresa emitente

- CNPJ e inscrição estadual compatíveis com a operação;
- credenciamento para emissão na SEFAZ da unidade federada correspondente;
- certificado digital ICP-Brasil apropriado e válido;
- regime tributário, endereço fiscal e série/numeração configurados;
- cadastro fiscal dos produtos: NCM, CFOP, unidade, origem, CST ou CSOSN e demais tributos aplicáveis;
- dados do destinatário, transporte, pagamentos e demais campos exigidos pela operação.

#### Fluxo de emissão

1. O pedido cria um rascunho fiscal editável.
2. O servidor valida cadastro, itens, numeração e regras tributárias.
3. O servidor gera o XML, assina ou envia ao provedor autorizado e solicita autorização.
4. A nota só muda para **autorizada** depois da resposta da SEFAZ.
5. O sistema guarda XML autorizado, protocolo, chave de acesso, eventos e vínculo com pedido, estoque, contas e pagamento.
6. Somente depois da autorização é gerado o DANFE em PDF para download, envio ao cliente e acompanhamento da mercadoria.
7. Rejeições retornam com mensagem compreensível e preservam o rascunho para correção; nunca devem ser registradas como nota emitida.

#### Segurança, auditoria e operação

- certificado e senha nunca podem ir para o navegador, GitHub, logs ou payloads do cliente;
- proteger credenciais no servidor com criptografia e serviço de gerenciamento de chaves, isoladas por empresa;
- exigir permissão específica para emitir, cancelar, inutilizar numeração ou corrigir documento;
- aplicar idempotência para impedir nota duplicada por clique repetido ou repetição de webhook;
- manter trilha de auditoria, sequência fiscal, status e cópia imutável do XML autorizado;
- implementar cancelamento, carta de correção, inutilização, consulta de status e contingência;
- monitorar vencimento do certificado, indisponibilidade da SEFAZ e divergências entre pedido, nota, estoque e financeiro;
- definir retenção, backup e acesso aos documentos conforme orientação contábil, fiscal e jurídica.

#### Critério de conclusão

A funcionalidade só pode ser anunciada como emissão fiscal quando um documento passar pela autorização oficial e o sistema devolver XML, protocolo e DANFE correspondentes. Até lá, o botão atual deve continuar identificado como **Pré-nota PDF — sem validade fiscal**.

Referências oficiais para implementação: [Portal Nacional da NF-e](https://www.nfe.fazenda.gov.br/), [requisitos para emissão e uso de sistema próprio](https://www.nfe.fazenda.gov.br/Portal/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=4figqHYhYho%3D), [certificação digital da NF-e](https://www.nfe.fazenda.gov.br/portal/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=FBya9bipr34%3D) e [NFS-e Padrão Nacional](https://www.gov.br/pt-br/servicos/emitir-nota-fiscal-de-servico-eletronica).

## Critério antes de construir o split real

Testar a versão financeira, a categorização por regras e o diagnóstico tributário com 5 a 10 empresas e contadores. Medir:

- tempo economizado por mês;
- percentual de categorias aceitas sem correção;
- frequência de uso;
- retenção;
- dúvidas tributárias mais comuns;
- disposição real de pagamento;
- necessidade comprovada de integração fiscal.

Se o simulador gerar interesse, mas não retenção, melhorar primeiro a rotina financeira. Se houver demanda comprovada de contadores e empresas por conciliação fiscal, avançar gradualmente para integrações.
