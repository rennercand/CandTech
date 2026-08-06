import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

import { calculateAmortization, calculateProductPrice } from "../lib/finance-calculations.js";
import { historyCsv } from "../lib/history-csv.js";
import { historyXlsx } from "../lib/history-xlsx.js";
import { calculateInvestment } from "../lib/investment-calculations.js";

const closeTo = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} deveria ser próximo de ${expected}`);

test("VPL coincide com o exemplo de referência do Excel", () => {
  const result = calculateInvestment({
    investment: 40_000,
    investmentDate: "2026-01-01",
    rate: 8,
    periods: 5,
    flows: [8_000, 9_200, 10_000, 12_000, 14_500].map((amount, index) => ({
      date: `202${7 + index}-01-01`,
      amount,
    })),
  });
  closeTo(result.npv, 1_922.06, 0.02);
});

test("TIR zera o VPL e coincide com o exemplo de referência", () => {
  const values = [12_000, 15_000, 18_000, 21_000, 26_000];
  const result = calculateInvestment({
    investment: 70_000,
    investmentDate: "2026-01-01",
    rate: 0,
    periods: values.length,
    flows: values.map((amount, index) => ({ date: `202${7 + index}-01-01`, amount })),
  });
  closeTo(result.irr, 8.66, 0.02);
});

test("ROI, índice de lucratividade e payback usam definições explícitas", () => {
  const result = calculateInvestment({
    investment: 100,
    investmentDate: "2026-01-01",
    rate: 10,
    periods: 3,
    flows: [30, 30, 80].map((amount, index) => ({
      date: `2026-0${index + 2}-01`,
      amount,
    })),
  });
  closeTo(result.roi, 40);
  closeTo(result.profitabilityIndex, 1.121712998, 1e-6);
  closeTo(result.payback, 2.5, 1e-9);
});

test("Price e SAF são equivalentes e liquidam o saldo", () => {
  const input = { principal: 10_000, rate: 1, periods: 12, startDate: "2026-01-31" };
  const price = calculateAmortization({ ...input, system: "PRICE" });
  const saf = calculateAmortization({ ...input, system: "SAF" });
  closeTo(price.firstPayment, 888.487887, 1e-6);
  closeTo(price.totalPaid, saf.totalPaid, 1e-8);
  closeTo(price.rows.at(-1).balance, 0, 1e-9);
  closeTo(price.rows.reduce((sum, row) => sum + row.amortization, 0), 10_000, 1e-6);
});

test("SAC mantém amortização constante e prestação decrescente", () => {
  const result = calculateAmortization({
    system: "SAC", principal: 1_200, rate: 1, periods: 12, startDate: "2026-01-31",
  });
  closeTo(result.firstPayment, 112);
  closeTo(result.lastPayment, 101);
  closeTo(result.totalInterest, 78);
  assert.equal(result.rows[1].date, "2026-02-28");
});

test("SAA paga juros periódicos e principal somente na última parcela", () => {
  const result = calculateAmortization({
    system: "SAA", principal: 1_200, rate: 1, periods: 12, startDate: "2026-01-31",
  });
  assert.equal(result.rows.slice(0, -1).every((row) => row.amortization === 0), true);
  closeTo(result.lastPayment, 1_212);
  closeTo(result.totalInterest, 144);
});

test("Preço por margem sobre venda reconcilia custo, lucro e faturamento", () => {
  const result = calculateProductPrice({
    expenses: [{ amount: 600 }, { amount: 400 }], units: 100, margin: 20,
  });
  closeTo(result.totalCost, 1_000);
  closeTo(result.unitCost, 10);
  closeTo(result.unitPrice, 12.5);
  closeTo(result.unitProfit, 2.5);
  closeTo(result.expectedRevenue, 1_250);
});

test("CSV e XLSX apresentam total gasto ao final da seção", () => {
  const item = {
    id: 1,
    title: "Auditoria",
    calculation_type: "VPL",
    created_at: "2026-08-01T00:00:00.000Z",
    payload: {
      table: [
        { period: 0, date: "2026-01-01", flow: -1_000 },
        { period: 1, date: "2026-02-01", flow: 600 },
      ],
    },
  };
  assert.match(historyCsv(item), /"Total gasto";-1000/);
  const files = unzipSync(new Uint8Array(historyXlsx(item)));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const workbook = strFromU8(files["xl/workbook.xml"]);
  assert.match(sheet, /Total gasto/);
  assert.match(sheet, /SUMIF/);
  assert.match(workbook, /name="CandTech"/);
});

test("XLSX detalha itens, múltiplos financiamentos e resumo financeiro", () => {
  const first = calculateAmortization({ principal: 10_000, rate: 2, periods: 12, startDate: "2026-01-10", system: "PRICE" });
  const item = {
    id: 2,
    title: "Documento empresarial",
    calculation_type: "tabela-financeira",
    created_at: "2026-08-05T00:00:00.000Z",
    payload: {
      financialTables: [
        { id: "estoque", state: { system: "PRICE", form: { description: "Estoque SKU-A", principal: 10_000, rate: 2, periods: 12 } }, result: first },
        { id: "equipamento", state: { system: "SAC", form: { description: "Máquina de corte", principal: 5_000, rate: 1.5, periods: 6, startDate: "2026-02-10" } } },
      ],
      workspace: {
        inventoryState: { products: [{ name: "Produto A", sku: "SKU-A", quantity: 25, minimum: 5, unitCost: 40, location: "A1" }] },
        commerceOrders: [], cashEntries: [], pricingState: { expenses: [] }, savedFinancings: [],
      },
    },
  };
  const files = unzipSync(new Uint8Array(historyXlsx(item)));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /Resumo dos financiamentos/);
  assert.match(sheet, /Estoque SKU-A/);
  assert.match(sheet, /Máquina de corte/);
  assert.match(sheet, /Quantidade total de itens/);
  assert.match(sheet, /Total de juros/);
  assert.match(sheet, /Total pago em financiamentos/);
  assert.match(sheet, /Resumo final/);
});
