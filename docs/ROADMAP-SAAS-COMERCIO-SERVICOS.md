# Roadmap SaaS — Comércio, Serviços e Base de Dados

Este documento define a evolução técnica e de produto da CandTech para atender inicialmente micro e pequenas empresas de comércio, serviços e operações híbridas. Ele complementa `ROADMAP-PRODUTO.md` e `ROADMAP-SEGURANCA.md`.

O status verificado do que existe e do que continua faltando está em [ROADMAP-PENDENCIAS.md](./ROADMAP-PENDENCIAS.md).

O objetivo não é transformar a CandTech em CRM. O núcleo continuará sendo ERP: operação, vendas, serviços, estoque, compras, financeiro, caixa, cobrança, conciliação e relatórios.

## Direção do produto

Posicionamento inicial:

> **ERP simples e automatizado para pequenos comércios e prestadores de serviços. Venda, serviço, estoque e financeiro trabalhando juntos.**

A automação deve reduzir digitação repetida e conectar módulos que normalmente funcionam separados.

Fluxos centrais:

- comércio: `compra → estoque → venda → recebimento → caixa → reposição`;
- serviços: `cliente → orçamento/serviço → execução → cobrança → recebimento → caixa`;
- híbrido: `serviço + produtos utilizados → baixa de estoque → cobrança → margem → financeiro`.

---

# P0 — Base SaaS multiempresa antes de escalar

## 1. Neon continua como banco principal

Manter PostgreSQL/Neon como banco transacional principal no estágio atual.

Não migrar de banco apenas por expectativa de crescimento. Primeiro medir:

- quantidade de empresas ativas;
- usuários simultâneos;
- consultas por minuto;
- tamanho das tabelas;
- latência p50/p95/p99;
- conexões e tempo de execução;
- custo mensal do banco;
- crescimento de vendas, movimentos de estoque e lançamentos financeiros.

Só reconsiderar a infraestrutura quando existirem métricas concretas que justifiquem a mudança.

## 2. Padronizar isolamento por organização

A CandTech já possui `organizations.id` relacional. Novos módulos devem usar preferencialmente:

**Progresso em 31/08/2026:** workspace e histórico concluíram a etapa gradual de escopo. Clientes, tarefas, entregas e o livro financeiro agora possuem tabelas relacionais próprias, FK organização, vínculos internos, backfill e marcadores de transição verificados em Preview e Production. A leitura relacional substitui os arrays legados após a migração e os testes negativos cobrem duas organizações. No estoque, `organization_id`, backfill coerente e índices foram aplicados em Preview e Production sem remover `tenant_id`; leituras e novas escritas conferem ambos e o teste cobre duas organizações reais. Falta apenas observar a transição antes de retirar o identificador legado em deploy posterior. O financeiro importa CSV/OFX/XLSX com prévia, fingerprint e desfazimento por lote, sugere conciliação reversível com contas e pedidos, controla séries recorrentes, parcelas, ajustes, pagamentos parciais, saldo e inadimplência e deriva alertas, agenda e previsão de 7/30/90 dias, sempre com regras explicáveis e confirmação humana. Entregas ainda precisam da interface, eventos e comprovante.

```text
organization_id BIGINT NOT NULL
REFERENCES organizations(id)
```

Evitar criar novas tabelas usando apenas `tenant_id TEXT` sem chave estrangeira.

Planejar migração gradual das tabelas existentes de estoque que usam `tenant_id TEXT` para `organization_id` real.

Estratégia segura:

1. adicionar `organization_id` nullable;
2. preencher os registros existentes usando a relação atual de tenant/empresa;
3. validar que nenhum registro ficou sem organização;
4. criar FK para `organizations(id)`;
5. adicionar índices compostos;
6. fazer o backend usar apenas `organization_id`;
7. somente depois remover o identificador legado.

Não fazer migração destrutiva em um único deploy.

## 3. Regra obrigatória para todas as consultas

Toda entidade operacional deve possuir uma organização proprietária direta ou derivável de forma inequívoca.

Exemplos:

- produtos;
- variações;
- estoque;
- movimentos;
- vendas;
- itens de venda;
- ordens de serviço;
- clientes;
- fornecedores;
- contas a pagar;
- contas a receber;
- caixas;
- compras;
- documentos;
- importações;
- automações.

Uma API nunca deve autorizar um recurso somente por `id` ou `public_id`.

Fluxo obrigatório:

```text
sessão autenticada
→ associação do usuário à organização
→ permissão
→ recurso pertencente à mesma organização
→ operação
```

Adicionar testes negativos de IDOR entre pelo menos duas organizações para cada novo módulo sensível.

## 4. Índices compostos orientados ao SaaS

Preferir índices que começam pela organização quando a consulta é multiempresa.

Exemplos conceituais:

```sql
(organization_id, created_at DESC)
(organization_id, status, due_at)
(organization_id, product_id, created_at DESC)
(organization_id, sku)
(organization_id, customer_id, created_at DESC)
```

Não adicionar índices indiscriminadamente. Medir consultas reais e usar `EXPLAIN ANALYZE` quando houver lentidão.

## 5. Migrations como única fonte estrutural em produção

Manter DDL versionado em `migrations/`.

Em produção:

- aplicação não cria tabela;
- aplicação não altera constraint;
- aplicação não executa reparo estrutural automaticamente;
- migration roda de forma controlada antes/depois do deploy conforme compatibilidade.

Usar padrão expand/contract para alterações importantes.

## 6. Separar produção, preview e desenvolvimento

Garantir bancos diferentes para:

- Production;
- Preview/Staging;
- desenvolvimento/testes.

Nunca permitir que Preview use o banco de produção por conveniência.

Dados reais de cliente não devem ser copiados para Preview sem anonimização e necessidade explícita.

---

# P0 — Refatoração do backend antes de novos módulos grandes

## 7. Quebrar o `lib/db.js` por domínio

O arquivo atual de banco concentra responsabilidades demais. Migrar gradualmente, sem reescrever tudo de uma vez.

Estrutura sugerida:

```text
lib/db/
  connection.js
  users.js
  organizations.js
  billing.js
  inventory.js
  sales.js
  services.js
  finance.js
  customers.js
  suppliers.js
  audit.js
  monitoring.js
```

Criar uma camada de acesso por domínio e migrar apenas o código que estiver sendo alterado.

Não criar ORM novo somente para refatorar. O objetivo é reduzir acoplamento e facilitar testes.

## 8. Serviço de contexto da organização

Criar uma função central equivalente a:

```text
resolveOrganizationContext(user)
```

Retorno esperado:

```text
organizationId
userId
role
permissions
isOwner
```

Rotas não devem reconstruir manualmente essa lógica de autorização.

## 9. Operações críticas devem ser transacionais

Venda, compra, cancelamento, devolução, pagamento e conclusão de serviço devem ser atômicos.

Uma venda não pode registrar receita e falhar ao baixar o estoque, ou baixar estoque e falhar ao criar o financeiro.

Exemplo conceitual:

```text
BEGIN

validar organização e permissão
criar venda
criar itens
baixar estoque
registrar movimentos
criar conta/recebimento
registrar evento de domínio
registrar auditoria

COMMIT
```

Falhou qualquer etapa:

```text
ROLLBACK
```

## 10. Controle de concorrência do estoque

Não usar apenas:

```text
ler quantidade
→ calcular no JavaScript
→ salvar nova quantidade
```

Isso permite corrida entre dois caixas.

Preferir update condicional/lock transacional no banco, garantindo que estoque não seja vendido duas vezes.

Exemplo conceitual:

```sql
UPDATE inventory_variants
SET quantity = quantity - :qty
WHERE id = :variant
  AND organization_id = :organization
  AND quantity >= :qty;
```

Se nenhuma linha for atualizada, retornar estoque insuficiente e não confirmar a venda.

## 11. Idempotência

Adicionar chave de idempotência em operações que podem chegar repetidas por internet instável, clique duplo ou webhook.

**Progresso em 31/08/2026:** a infraestrutura persistente foi criada e aplicada em Preview e Production. Histórico e mutações do estoque exigem chave, detectam conteúdo conflitante e devolvem a resposta concluída em repetição. Pedidos possuem deduplicação persistida por organização; repetir a mesma venda não baixa o estoque novamente. Ainda falta aplicar o contrato às operações críticas fora desses módulos.

Prioridade:

- confirmar venda;
- concluir serviço;
- registrar pagamento;
- receber compra;
- cancelar/devolver;
- importações;
- futuras integrações externas.

A mesma chave não pode gerar duas baixas de estoque ou duas receitas.

---

# P1 — Modelo operacional comum para Comércio + Serviços

## 12. Catálogo unificado

Criar conceito que permita itens do tipo:

```text
product
service
```

Produto:

- pode controlar estoque;
- custo;
- preço;
- SKU/EAN;
- fornecedor;
- estoque mínimo.

Serviço:

- não precisa controlar estoque diretamente;
- preço;
- custo estimado;
- duração;
- responsável;
- pode consumir produtos/materiais.

## 13. Venda/pedido unificado

Uma operação pode conter produtos e serviços simultaneamente.

Exemplo:

```text
1 SSD 1 TB        R$ 320
1 Instalação      R$ 120
Total             R$ 440
```

Ao confirmar:

- baixa somente produtos controlados em estoque;
- registra venda;
- registra CMV/custos aplicáveis;
- registra receita ou conta a receber;
- atualiza caixa quando aplicável;
- calcula margem;
- cria movimentos auditáveis;
- verifica reposição.

## 14. Ordem de serviço simples

Estados sugeridos:

```text
draft
approved
scheduled
in_progress
completed
cancelled
```

Campos principais:

- organização;
- cliente;
- descrição;
- responsável;
- prazo/data;
- itens de serviço;
- materiais utilizados;
- valor;
- custo estimado/real;
- observações.

Ao concluir um serviço:

```text
consumir materiais
→ registrar custos
→ gerar conta a receber
→ atualizar margem
→ registrar auditoria
```

Não adicionar pipeline de lead, campanha ou prospecção nesta fase.

---

# P1 — Automação operacional

## 15. Motor de eventos de domínio

Criar eventos internos previsíveis em vez de cron verificando empresa por empresa.

Eventos iniciais:

```text
SALE_CONFIRMED
SALE_CANCELLED
PURCHASE_RECEIVED
SERVICE_COMPLETED
PAYMENT_RECEIVED
STOCK_ADJUSTED
INVOICE_OVERDUE
```

Exemplo:

```text
SALE_CONFIRMED
→ movimento de estoque
→ financeiro
→ margem
→ caixa
→ reposição
→ auditoria
```

Não usar fila distribuída complexa enquanto o volume não exigir. Começar com processamento transacional/síncrono para os efeitos essenciais e reservar jobs assíncronos para tarefas não críticas.

## 16. Outbox para integrações futuras

Quando webhooks, e-mails, contador, marketplace ou integrações externas crescerem, implementar padrão transactional outbox.

**Progresso em 31/08/2026:** tabela, deduplicação e worker protegido foram implementados. Venda/compra, movimentos, pedido, itens e evento usam uma única transação serializável; o worker faz claim exclusivo, limita tentativas, aplica backoff e não descarta tipos desconhecidos. Antes de webhooks externos, cada novo consumidor deverá ganhar assinatura, política de reprocessamento e teste de entrega.

Transação salva:

```text
venda + estoque + financeiro + outbox_event
```

Depois um worker processa o evento externo.

Assim uma queda da API externa não desfaz a venda nem perde a notificação.

## 17. Jobs assíncronos somente onde fazem sentido

Candidatos:

- geração de relatório pesado;
- exportação XLSX/PDF;
- envio de e-mail;
- sincronizações externas;
- conciliação em lote;
- análise ABC;
- cálculo de previsão de ruptura em massa.

Não colocar confirmação de venda ou baixa essencial de estoque numa fila que pode atrasar.

---

# P1 — Funcionalidades para comércio

## 18. PDV/venda rápida

- pesquisa por produto;
- SKU/EAN;
- leitor de código de barras como entrada de teclado;
- quantidade;
- desconto controlado por permissão;
- cliente opcional;
- formas de pagamento;
- confirmação rápida.

## 19. Estoque automático

Venda confirmada:

```text
→ baixa estoque
→ movimento imutável
→ verificar mínimo
→ recalcular dias de cobertura
```

Compra recebida:

```text
→ entrada estoque
→ atualizar custo
→ criar conta a pagar
→ recalcular margem
```

## 20. Reposição inteligente

Calcular de forma determinística:

- estoque atual;
- média de venda;
- dias de cobertura;
- estoque mínimo;
- prazo médio do fornecedor;
- quantidade sugerida.

Exibir algo semelhante a:

> Estoque: 8 unidades · média: 5/dia · cobertura: 1,6 dia · sugestão: comprar 30.

Primeira versão deve explicar a fórmula utilizada.

## 21. Curva ABC e estoque parado

- classificação A/B/C por faturamento e/ou margem;
- produtos sem venda em 30/60/90 dias;
- capital estimado parado;
- alertas acionáveis.

---

# P1 — Funcionalidades para serviços

## 22. Orçamento → serviço → cobrança

Fluxo:

```text
orçamento
→ aprovado
→ ordem de serviço
→ execução
→ conclusão
→ conta a receber
```

Evitar recadastro das mesmas informações.

## 23. Agenda operacional

Mostrar:

- serviços de hoje;
- responsável;
- cliente;
- horário;
- endereço/local;
- status.

A agenda é operacional, não pipeline comercial.

## 24. Serviços recorrentes

Ao concluir ou vencer um ciclo recorrente:

- criar próxima previsão;
- gerar cobrança/conta conforme configuração;
- alertar quando execução estiver próxima;
- nunca cobrar ou alterar financeiro silenciosamente sem regra previamente configurada.

---

# P1 — Tela Hoje

## 25. Home orientada à ação

Comércio:

- vendas hoje;
- margem estimada;
- contas a receber/pagar hoje;
- produtos para reposição;
- divergências de caixa.

Serviço:

- serviços hoje;
- atrasados;
- concluídos ainda não cobrados;
- valores a receber;
- inadimplência.

Híbrido combina os dois.

Cada alerta deve oferecer uma ação concreta.

Evitar dashboard com muitos gráficos sem decisão associada.

---

# P1 — Financeiro e conciliação

## 26. Contas ligadas à operação

Venda a prazo:

```text
→ conta a receber
```

Compra parcelada:

```text
→ contas a pagar
```

Serviço concluído:

```text
→ cobrança/conta a receber
```

Pagamento:

```text
→ baixar conta
→ atualizar caixa
→ auditoria
```

## 27. Conciliação bancária antes de Open Finance completo

Priorizar:

- OFX;
- CSV;
- importação com preview;
- deduplicação;
- sugestão de correspondência.

Exemplo:

```text
PIX recebido R$ 180
↕
Cobrança CandTech / venda / conta a receber de R$ 180
```

A primeira versão apenas sugere. Usuário confirma casos ambíguos.

---

# P1 — Cobrança da própria CandTech

## 28. Manter PIX manual sem gateway

Enquanto não houver integração bancária/gateway adequada:

```text
cliente cria conta
→ gera Pix com valor e TXID
→ paga
→ administrador confere no banco
→ aprovação manual
→ assinatura ativa
```

Comprovante é opcional.

A aprovação do administrador é a fonte de verdade operacional nesta fase.

Nunca pedir:

- senha bancária;
- senha da conta CandTech durante pagamento;
- token do banco;
- dados de cartão desnecessários.

## 29. Evolução sem gateway: conciliação administrativa

Permitir importar extrato OFX/CSV da conta utilizada para recebimentos da CandTech.

O sistema pode sugerir correspondências entre:

- valor;
- data;
- nome do pagador quando disponível;
- TXID/identificador quando presente;
- cobrança pendente.

Administrador confirma com um clique.

Isso reduz trabalho manual sem fingir confirmação bancária automática.

---

# P2 — Observabilidade e crescimento do banco

## 30. Métricas de banco

Acompanhar:

- latência por endpoint;
- consultas lentas;
- erros de banco;
- tempo de transação;
- volume por organização;
- tamanho das tabelas;
- crescimento de `inventory_movements`, vendas e audit log;
- taxa de cache quando houver;
- custo de banco por cliente/receita.

Não armazenar SQL sensível ou dados pessoais completos em logs.

## 31. Paginação obrigatória

Listagens operacionais não devem carregar histórico inteiro.

**Progresso em 30/08/2026:** o histórico já usa cursor opaco, limite máximo e carregamento incremental na interface, com teste de isolamento por conta. As listas abaixo continuam no escopo até que todas adotem o mesmo contrato.

Prioridade:

- vendas;
- movimentos;
- auditoria;
- contas;
- serviços;
- clientes;
- produtos;
- pagamentos administrativos.

Preferir paginação por cursor em históricos grandes.

## 32. Evitar N+1

Revisar páginas que buscam um registro e depois fazem uma consulta adicional para cada item.

Usar joins/batches quando apropriado, mantendo isolamento por organização.

## 33. Retenção e arquivamento

Definir políticas específicas para:

- logs técnicos;
- sessões;
- tokens expirados;
- eventos de monitoramento;
- comprovantes;
- auditoria;
- documentos fiscais futuros.

Dados financeiros não devem ser apagados automaticamente sem política legal/contratual adequada.

---

# P2 — Backup, recuperação e continuidade

## 34. Backup não é só exportação

Definir e testar:

- backup do banco;
- restauração;
- RPO desejado;
- RTO desejado;
- responsável pela recuperação;
- procedimento de incidente.

Executar restauração de teste periodicamente.

Um backup que nunca foi restaurado não deve ser considerado validado.

## 35. Integridade financeira

Criar verificações periódicas de consistência, por exemplo:

- venda concluída sem itens;
- movimento de estoque sem referência válida;
- pedido cancelado com efeitos não revertidos;
- conta marcada como paga sem pagamento correspondente;
- estoque agregado divergente do livro de movimentos;
- dados operacionais sem organização.

O sistema deve alertar, não corrigir silenciosamente dados financeiros.

---

# P2 — Escalabilidade sem overengineering

## 36. Não criar microserviços agora

Manter monólito modular enquanto:

- equipe é pequena;
- volume ainda é moderado;
- deploy único simplifica operação;
- os domínios podem ser separados por módulos internos.

Extrair serviço separado somente quando existir motivo mensurável, como:

- processamento muito pesado;
- requisitos de disponibilidade diferentes;
- escala independente comprovada;
- integração externa complexa;
- isolamento de segurança necessário.

## 37. Não trocar Neon cedo demais

Neon/PostgreSQL deve continuar enquanto atender latência, disponibilidade, armazenamento e custo.

Antes de migrar, tentar:

1. melhorar queries;
2. corrigir índices;
3. paginar;
4. reduzir N+1;
5. separar tarefas assíncronas;
6. revisar conexão/pooling conforme a arquitetura de deploy;
7. arquivar dados técnicos que não precisam ficar quentes.

Migração de banco é P3/P4, não feature comercial.

---

# P2 — Segurança de dados multiempresa

## 38. Defesa em profundidade

Além da validação no backend, estudar Row Level Security (RLS) do PostgreSQL para módulos multiempresa maduros.

Não ativar RLS às pressas em tabelas existentes sem testes, pois políticas incorretas podem bloquear produção ou criar falsa sensação de isolamento.

Antes:

- padronizar `organization_id`;
- criar testes de acesso cruzado;
- documentar contexto de tenant;
- definir como a conexão informa a organização atual;
- testar jobs administrativos e migrations.

Depois considerar RLS como segunda barreira de isolamento.

## 39. Public IDs

Continuar evitando IDs sequenciais como identificador público de recursos sensíveis.

Usar UUID/public_id externamente e manter PK numérica internamente quando conveniente.

Public ID não substitui autorização por organização.

---

# P3 — Integrações externas

## 40. API e webhooks

Somente depois do núcleo estar estável:

- API por organização;
- escopos de acesso;
- chaves revogáveis;
- rate limit por organização/chave;
- assinatura de webhook;
- idempotência;
- retry com backoff;
- dead-letter/reprocessamento para eventos falhos.

## 41. E-commerce e marketplaces

Priorizar conforme clientes reais pedirem.

Possíveis integrações futuras:

- WooCommerce;
- Shopify;
- marketplaces;
- delivery/PDV externo.

Fluxo esperado:

```text
venda externa
→ webhook/API
→ pedido CandTech
→ estoque
→ financeiro
```

Nunca tentar descobrir vendas externas sem integração ou importação.

---

# Ordem prática de implementação

## Agora — P0

1. padronizar `organization_id` e planejar migração do `tenant_id` textual;
2. extrair gradualmente `lib/db.js` em módulos de persistência;
3. criar contexto central de organização/permissões;
4. reforçar testes IDOR/multiempresa;
5. implementar transações e idempotência para operações novas;
6. revisar índices principais;
7. manter migrations como única fonte de DDL em produção;
8. separar bancos Production/Preview/Test e testar restauração.

## Próximo — P1 vendável

1. venda/pedido unificado;
2. baixa de estoque transacional;
3. financeiro automático da venda;
4. compras e fornecedores;
5. ordem de serviço;
6. materiais consumidos por serviço;
7. Tela Hoje;
8. contas a pagar/receber integradas;
9. reposição inteligente;
10. OFX/CSV + conciliação;
11. fechamento diário;
12. curva ABC e estoque parado.

## Depois — P2 diferenciação

1. relatórios automáticos;
2. previsão de ruptura;
3. margem/preço inteligente;
4. outbox e jobs assíncronos;
5. RLS como segunda camada após padronização;
6. observabilidade de banco;
7. Reforma Tributária IBS/CBS;
8. simulador de split payment.

## Futuro — P3 escala e integrações

1. Open Finance;
2. Pix automático/bancário;
3. e-commerce/marketplaces;
4. emissão fiscal oficial;
5. API pública;
6. automações externas;
7. avaliar infraestrutura de banco apenas com métricas reais.

---

# Critério de arquitetura

Toda nova feature deve responder antes de ser implementada:

1. Qual organização é dona deste registro?
2. Quem pode lê-lo e alterá-lo?
3. A operação precisa ser transacional?
4. O que acontece se a mesma requisição chegar duas vezes?
5. Existe trilha de auditoria?
6. A consulta possui índice adequado para crescer por organização?
7. O histórico precisa de paginação?
8. Existe efeito financeiro ou de estoque que não pode ficar parcialmente aplicado?
9. Como a operação é revertida/cancelada?
10. Qual teste impede acesso cruzado entre empresas?

Se essas respostas não estiverem claras, a feature ainda não está pronta para ser considerada SaaS multiempresa segura.
