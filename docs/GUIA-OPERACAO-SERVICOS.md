# Guia de operação — ordens de serviço

Este guia descreve o fluxo vendável de serviços da CandTech. A área **Ordens de serviço** é liberada por permissão e mantém orçamento, agenda, consumo de materiais, custo e cobrança no escopo da empresa autenticada.

## 1. Criar o orçamento

1. Abra **Ordens de serviço** no menu.
2. Informe título, cliente, responsável, agenda, vencimento e local.
3. Adicione linhas do tipo **Serviço** para mão de obra e do tipo **Material** para itens do estoque.
4. Preencha preço unitário e custo unitário. A tela mostra preço total, custo estimado e margem estimada antes de salvar.
5. Se o trabalho se repetir, escolha recorrência semanal, mensal ou anual e um total de 2 a 60 ciclos.
6. Clique em **Criar orçamento**.

Materiais precisam apontar para um SKU existente na mesma empresa. O sistema não aceita um identificador de outra organização nem cria material sem vínculo ao estoque.

## 2. Aprovar e executar

O fluxo normal é:

```text
Orçamento/Rascunho → Aprovado → Agendado → Em execução → Concluído
```

- **Aprovar:** registra que a proposta foi aceita.
- **Agendar:** confirma a inclusão na agenda operacional.
- **Iniciar:** informa que a execução começou.
- **Cancelar:** encerra uma ordem ainda não concluída sem baixar material nem criar cobrança.
- **Concluir e cobrar:** aparece somente durante a execução e pede confirmação.

## 3. O que acontece na conclusão

A conclusão é uma única operação no banco:

1. confere que a ordem ainda está em execução;
2. baixa cada material dos lotes que vencem primeiro (FEFO);
3. impede saldo negativo com atualização condicional;
4. grava os movimentos de estoque e o custo real;
5. muda a ordem para concluída;
6. cria uma conta a receber quando o total cobrado é maior que zero;
7. cria o próximo serviço agendado quando há recorrência restante;
8. registra o evento para integrações e auditoria.

Se faltar saldo ou qualquer etapa falhar, tudo é revertido. Não fica baixa parcial, cobrança sem serviço ou próximo ciclo incompleto.

## 4. Clique repetido e internet instável

A API exige uma chave de idempotência persistida. Repetir exatamente a mesma solicitação retorna o resultado anterior; reutilizar a chave para outro conteúdo é recusado. A conclusão também possui evento único e trava lógica para impedir que duas requisições concorrentes baixem material ou criem duas contas.

## 5. Custos e margem

- **Preço unitário:** valor cobrado por unidade do serviço ou material.
- **Custo unitário:** custo interno previsto da mão de obra ou do material.
- **Margem estimada:** preço total menos custo estimado.
- **Custo real:** soma das quantidades pelos custos unitários fixada ao concluir.
- **Margem realizada do serviço:** preço total menos custo real.

O custo é informação gerencial; a CandTech não substitui apuração contábil ou fiscal. Ajuste os valores antes de aprovar e mantenha os custos dos SKUs atualizados.

## 6. Conferência diária

Os indicadores no topo mostram serviços de hoje, atrasados, em aberto e concluídos sem cobrança. Use a lista para conferir responsável, horário, local, ciclo recorrente e estado da cobrança.

## 7. Teste recomendado antes do primeiro cliente

1. cadastre um SKU de teste com lote, validade e cinco unidades;
2. crie uma ordem com duas unidades desse material;
3. aprove, agende, inicie e conclua;
4. confirme que o saldo caiu para três unidades;
5. abra **Movimentações** e confira a conta a receber;
6. tente concluir novamente e confirme que nada é duplicado;
7. repita com quantidade acima do saldo e confirme que a ordem continua em execução, sem cobrança e sem baixa parcial.

## 8. Permissões e suporte

O proprietário acessa todas as áreas. Funcionários só enxergam ordens de serviço quando a permissão **Ordens de serviço** está no cargo ou convite. Em caso de erro, registre o horário, o título da ordem e a ação tentada; não envie senha, chave de banco, token ou arquivo de ambiente ao suporte.
