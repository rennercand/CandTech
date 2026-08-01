"use client";

import { useMemo } from "react";
import {
  calculateAmortization,
  calculateProductPrice,
} from "../lib/finance-calculations";
import { parseStatementLines } from "../lib/statement-parser";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const formatDate = (value) => {
  const [year, month, day] = String(value || "")
    .slice(0, 10)
    .split("-");
  return year && month && day ? `${day}/${month}/${year}` : "Sem data";
};
const today = () => new Date().toISOString().slice(0, 10);

const FINANCIAL_SYSTEMS = ["PRICE", "SAF", "SAA", "SAC"];

function SummaryCard({ label, value, tone = "default" }) {
  return (
    <article className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function FinanceTables({ state, setState, onSave }) {
  // O estado vem da página para poder ser salvo no workspace da conta.
  const { system, form } = state;
  const setSystem = (systemValue) =>
    setState((current) => ({ ...current, system: systemValue }));
  const setForm = (formValue) =>
    setState((current) => ({ ...current, form: formValue }));
  const result = useMemo(
    () => calculateAmortization({ ...form, system }),
    [form, system],
  );

  const systemText = {
    PRICE:
      "Prestação constante; os juros diminuem e a amortização aumenta a cada parcela.",
    SAF: "SAF é o Sistema de Amortização Francês: matematicamente, é a própria Tabela Price.",
    SAA: "Juros periódicos sobre o principal; toda a amortização é paga na última parcela.",
    SAC: "Amortização constante; juros e prestações diminuem junto com o saldo devedor.",
  }[system];

  return (
    <section className="tool-stack">
      <article className="panel finance-intro">
        <span className="eyebrow">SIMULADOR DE FINANCIAMENTO</span>
        <div className="panel-heading">
          <div>
            <h2>Tabela financeira</h2>
            <p>{systemText}</p>
          </div>
          <div className="system-tabs" aria-label="Sistema de amortização">
            {FINANCIAL_SYSTEMS.map((item) => (
              <button
                key={item}
                className={system === item ? "active" : ""}
                onClick={() => setSystem(item)}
              >
                {item}
              </button>
            ))}
            <button className="primary-button compact module-save" onClick={onSave}>
              Salvar no histórico
            </button>
          </div>
        </div>
      </article>

      <section className="calculator-grid finance-grid">
        <article className="panel input-panel">
          <span className="eyebrow">DADOS DO CONTRATO</span>
          <h2>Premissas</h2>
          <div className="field-grid">
            <label>
              Valor financiado
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={form.principal}
                onChange={(event) =>
                  setForm({ ...form, principal: event.target.value })
                }
              />
            </label>
            <label>
              Taxa por mês (%)
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={form.rate}
                onChange={(event) =>
                  setForm({ ...form, rate: event.target.value })
                }
              />
            </label>
            <label>
              Quantidade de parcelas
              <input
                type="number"
                min="1"
                max="600"
                placeholder="0"
                value={form.periods}
                onChange={(event) =>
                  setForm({ ...form, periods: event.target.value })
                }
              />
            </label>
            <label>
              Primeiro vencimento
              <input
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm({ ...form, startDate: event.target.value })
                }
              />
            </label>
          </div>
          <div className="formula-memory">
            <span className="eyebrow">MEMÓRIA DE CÁLCULO</span>
            {system === "PRICE" || system === "SAF" ? (
              <>
                <code>PMT = PV × i ÷ (1 − (1 + i)⁻ⁿ)</code>
                <p>
                  Juros = saldo anterior × taxa; amortização = prestação −
                  juros. PRICE e SAF são equivalentes.
                </p>
              </>
            ) : system === "SAC" ? (
              <>
                <code>Amortização = PV ÷ n</code>
                <p>
                  Juros = saldo anterior × taxa; prestação = amortização +
                  juros.
                </p>
              </>
            ) : (
              <>
                <code>Juros = PV × i</code>
                <p>
                  A amortização é zero até a última parcela, quando o principal
                  inteiro é quitado.
                </p>
              </>
            )}
            <small>
              Simulação sem seguros, tarifas, impostos ou correção por
              indexadores como TR e IPCA.
            </small>
          </div>
        </article>

        <article className="panel result-panel finance-result">
          <span className="eyebrow">RESULTADO</span>
          <h2>{system === "SAF" ? "SAF / Tabela Price" : system}</h2>
          <div className="summary-grid">
            <SummaryCard
              label="Primeira parcela"
              value={money.format(result.firstPayment)}
            />
            <SummaryCard
              label="Última parcela"
              value={money.format(result.lastPayment)}
            />
            <SummaryCard
              label="Total de juros"
              value={money.format(result.totalInterest)}
              tone="expense"
            />
            <SummaryCard
              label="Total pago"
              value={money.format(result.totalPaid)}
            />
          </div>
          <div className="table-scroll finance-table">
            <table>
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th>Saldo inicial</th>
                  <th>Prestação</th>
                  <th>Juros</th>
                  <th>Amortização</th>
                  <th>Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.period}>
                    <td>{row.period}</td>
                    <td>{formatDate(row.date)}</td>
                    <td>{money.format(row.openingBalance)}</td>
                    <td>{money.format(row.payment)}</td>
                    <td className="negative">{money.format(row.interest)}</td>
                    <td className="positive">
                      {money.format(row.amortization)}
                    </td>
                    <td>{money.format(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
  );
}

const blankExpense = () => ({ name: "", amount: "" });

export function ProductPricing({ state, setState, onSave }) {
  // Manter estes campos no componente pai permite restaurá-los após um novo login.
  const { expenses, units, margin } = state;
  const setExpenses = (value) =>
    setState((current) => ({
      ...current,
      expenses: typeof value === "function" ? value(current.expenses) : value,
    }));
  const setUnits = (value) =>
    setState((current) => ({ ...current, units: value }));
  const setMargin = (value) =>
    setState((current) => ({ ...current, margin: value }));
  const result = useMemo(
    () => calculateProductPrice({ expenses, units, margin }),
    [expenses, units, margin],
  );

  function editExpense(index, field, value) {
    setExpenses((current) =>
      current.map((expense, position) =>
        position === index ? { ...expense, [field]: value } : expense,
      ),
    );
  }

  return (
    <section className="calculator-grid product-grid">
      <article className="panel input-panel">
        <span className="eyebrow">FORMAÇÃO DE PREÇO</span>
        <div className="panel-heading">
          <div>
            <h2>Despesas do produto</h2>
            <p>Some matéria-prima, embalagem, frete, mão de obra e taxas.</p>
          </div>
          <button
            className="secondary-button"
            onClick={() =>
              setExpenses((current) => [...current, blankExpense()])
            }
          >
            + Despesa
          </button>
        </div>
        <div className="expense-list">
          {expenses.map((expense, index) => (
            <div className="expense-row" key={index}>
              <input
                aria-label={`Nome da despesa ${index + 1}`}
                placeholder="Ex.: embalagem"
                value={expense.name}
                onChange={(event) =>
                  editExpense(index, "name", event.target.value)
                }
              />
              <input
                aria-label={`Valor da despesa ${index + 1}`}
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={expense.amount}
                onChange={(event) =>
                  editExpense(index, "amount", event.target.value)
                }
              />
              <button
                aria-label={`Remover despesa ${index + 1}`}
                className="remove-row"
                disabled={expenses.length === 1}
                onClick={() =>
                  setExpenses((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="field-grid">
          <label>
            Unidades para diluir o custo
            <input
              type="number"
              min="1"
              placeholder="0"
              value={units}
              onChange={(event) => setUnits(event.target.value)}
            />
          </label>
          <label>
            Margem de lucro desejada (%)
            <input
              type="number"
              min="0"
              max="99.99"
              step="0.01"
              placeholder="0,00"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
            />
          </label>
        </div>
      </article>

      <article className="panel pricing-result">
        <div className="panel-heading">
          <span className="eyebrow">PREÇO SUGERIDO</span>
          <button className="primary-button compact" onClick={onSave}>
            Salvar no histórico
          </button>
        </div>
        <div className="unit-price">
          <span>Valor unitário do produto</span>
          <strong>{money.format(result.unitPrice)}</strong>
        </div>
        <div className="summary-grid">
          <SummaryCard
            label="Despesas totais"
            value={money.format(result.totalCost)}
          />
          <SummaryCard
            label="Custo por unidade"
            value={money.format(result.unitCost)}
          />
          <SummaryCard
            label="Lucro por unidade"
            value={money.format(result.unitProfit)}
            tone="income"
          />
          <SummaryCard
            label="Faturamento esperado"
            value={money.format(result.expectedRevenue)}
          />
        </div>
        <div className="formula-memory">
          <span className="eyebrow">MEMÓRIA DE CÁLCULO</span>
          <code>Custo unitário = despesas totais ÷ unidades</code>
          <code>Preço = custo unitário ÷ (1 − margem)</code>
          <p>
            A margem é calculada sobre o preço de venda. Por exemplo, 20% de
            margem não é o mesmo que acrescentar 20% ao custo.
          </p>
        </div>
      </article>
    </section>
  );
}

const PIE_COLORS = [
  "#6950e8",
  "#14a67a",
  "#f0a02f",
  "#e05268",
  "#3498db",
  "#9b59b6",
];

export function ExpensePieChart({ entries }) {
  const groups = useMemo(() => {
    const totals = new Map();
    entries
      .filter((entry) => entry.type === "saida")
      .forEach((entry) => {
        const category = entry.category || "Sem categoria";
        totals.set(
          category,
          (totals.get(category) || 0) + Number(entry.amount || 0),
        );
      });
    return [...totals.entries()]
      .map(([category, value]) => ({ category, value }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [entries]);
  const total = groups.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const gradient = groups
    .map((item, index) => {
      const start = cursor;
      cursor += (item.value / total) * 100;
      return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${cursor}%`;
    })
    .join(", ");

  return (
    <article className="panel pie-panel">
      <span className="eyebrow">DISTRIBUIÇÃO DOS GASTOS</span>
      <h2>Custos por categoria</h2>
      {total > 0 ? (
        <div className="pie-layout">
          <div
            className="animated-pie"
            style={{ background: `conic-gradient(${gradient})` }}
            role="img"
            aria-label={`Gráfico de gastos no total de ${money.format(total)}`}
          >
            <span>{money.format(total)}</span>
          </div>
          <div className="pie-legend">
            {groups.map((item, index) => (
              <div key={item.category}>
                <i
                  style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                <span>{item.category}</span>
                <strong>{money.format(item.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty-chart">
          Classifique despesas para formar o gráfico.
        </p>
      )}
    </article>
  );
}

export async function parseBankStatementPdf(file) {
  // PDF.js lê o arquivo somente no navegador; o extrato não é enviado ao servidor.
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const lines = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = [];
    content.items.forEach((item) => {
      const text = item.str?.trim();
      if (!text) return;
      const y = item.transform?.[5] || 0;
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x: item.transform?.[4] || 0, text });
    });
    rows
      .sort((a, b) => b.y - a.y)
      .forEach((row) => {
        const line = row.items
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text)
          .join(" ");
        lines.push(line);
      });
  }
  return parseStatementLines(lines);
}
