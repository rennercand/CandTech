# Auditoria das fórmulas financeiras

Data da revisão: 2026-08-01.

## Escopo e resultado

Foram revisados VPL, TIR, ROI, payback simples, índice de lucratividade, PRICE/SAF, SAC, SAA e formação de preço. Os casos automatizados estão em `test/finance-calculations.test.js`.

| Cálculo | Definição utilizada | Situação |
| --- | --- | --- |
| VPL | investimento inicial no instante zero mais fluxos futuros descontados pela taxa mensal | Validado contra exemplo do Microsoft Excel |
| TIR | taxa mensal que zera o VPL de um fluxo convencional | Validada contra exemplo do Microsoft Excel |
| ROI do projeto | ganho líquido não descontado dividido pelo total desembolsado | Definição explicitada e testada |
| Payback | primeiro cruzamento do acumulado para zero, com interpolação linear dentro do período | Validado por caso independente |
| Índice de lucratividade | valor presente dos fluxos futuros dividido pelo investimento inicial | Corrigido; substituiu o indicador ambíguo “Atividade” |
| ROE | lucro líquido contábil dividido pelo patrimônio líquido médio | Não calculado por ausência dessas entradas contábeis |
| PRICE / SAF | prestação constante; juros sobre saldo e amortização por diferença | Validado e reconciliado com o principal |
| SAC | amortização constante e prestação decrescente | Validado e reconciliado com o principal |
| SAA | juros periódicos e principal integral no vencimento final | Validado e reconciliado com o principal |
| Formação de preço | custo unitário dividido por `1 - margem sobre venda` | Validada por reconciliação de custo, lucro e receita |

## Correções realizadas

- “Atividade” não possuía uma definição financeira padronizada e foi removida.
- O índice de lucratividade agora é exibido como múltiplo, por exemplo `1,121×`, e não como percentual.
- O ROI considera o investimento inicial e eventuais saídas adicionais como capital desembolsado.
- A busca da TIR amplia dinamicamente o intervalo para não limitar resultados a 1.000% por período.
- A opção visual “Anual” foi removida porque não alterava o estado nem a fórmula. O cálculo agora informa claramente que taxa e fluxos são mensais e igualmente espaçados.
- Exportações CSV e XLSX agora apresentam `Total gasto` ao final de cada seção aplicável.

## Premissas e limites

- VPL e TIR são periódicos, com fluxos mensais igualmente espaçados. Para datas irregulares seria necessário implementar XNPV/XIRR e definir uma taxa anual.
- O payback exibido é simples, sem desconto dos fluxos.
- TIR é apresentada somente quando o fluxo possui uma única troca de sinal, reduzindo o risco de mostrar uma raiz ambígua.
- As tabelas não incluem seguros, tarifas, IOF, CET, inflação, TR, IPCA, carência ou mudança de taxa.
- A formação de preço não inclui tributos ou comissões automaticamente; esses valores devem ser cadastrados como despesas ou tratados em uma evolução específica.
- Os resultados são ferramentas de simulação e não substituem demonstrações contábeis, contrato bancário ou parecer profissional.

## Referências consultadas

- Microsoft, NPV: https://support.microsoft.com/en-us/excel/functions/npv-function
- Microsoft, IRR: https://support.microsoft.com/en-us/Excel/functions/irr-function
- Microsoft, PMT: https://support.microsoft.com/en-US/Excel/pmt-function
- Governo Federal/ANTAQ, fórmula do ROE: https://www.gov.br/antaq/pt-br/central-de-conteudos/publicacoes-da-antaq/UREFL_RelatorioMACRO_PortoSFS.pdf
- CFI, índice de lucratividade: https://corporatefinanceinstitute.com/resources/accounting/profitability-index/
- CFI, ROI: https://corporatefinanceinstitute.com/resources/accounting/return-on-investment-roi-formula/
