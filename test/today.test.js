import assert from "node:assert/strict";
import test from "node:test";
import { buildTodaySnapshot } from "../lib/today.js";

test("tela Hoje prioriza caixa, serviços e exceções sem misturar áreas ocultas", () => {
  const snapshot = buildTodaySnapshot({
    date: "2026-09-01",
    dailySales: { count: 3, gross: 210, discounts: 10, total: 200, cost: 120, margin: 80, pending: 1 },
    commitments: [
      { id: "r1", type: "receber", description: "Cliente", party: "Loja", dueDate: "2026-08-31", amount: 100, paidAmount: 20, status: "parcial" },
      { id: "p1", type: "pagar", description: "Fornecedor", dueDate: "2026-09-01", amount: 40, status: "pendente" },
      { id: "future", type: "receber", dueDate: "2026-09-02", amount: 999, status: "pendente" },
    ],
    inventory: { products: [{ name: "Café", unit: "un", variants: [{ id: "v1", name: "500g", quantity: 0, minimumQuantity: 3 }] }], lots: [] },
    services: [
      { id: "s1", title: "Instalação", scheduledFor: "2026-08-30T12:00:00.000Z", status: "scheduled", quotedAmount: 300, billed: false },
      { id: "s2", title: "Revisão", scheduledFor: "2026-09-01T12:00:00.000Z", status: "scheduled", quotedAmount: 100, billed: false },
      { id: "s3", title: "Sem cobrança", status: "completed", quotedAmount: 50, billed: false },
    ],
  });
  assert.equal(snapshot.clear, false);
  assert.deepEqual(snapshot.summary.find((item) => item.id === "sales"), {
    id: "sales", label: "Vendas hoje", value: 3, amount: 200, tone: "positive", target: "commerce",
  });
  assert.equal(snapshot.summary.find((item) => item.id === "margin").amount, 80);
  assert.equal(snapshot.summary.find((item) => item.id === "receivable").amount, 80);
  assert.equal(snapshot.summary.find((item) => item.id === "payable").amount, 40);
  assert.equal(snapshot.groups.find((group) => group.id === "finance").items.length, 2);
  assert.equal(snapshot.groups.find((group) => group.id === "inventory").tone, "danger");
  assert.equal(snapshot.groups.find((group) => group.id === "services").items.length, 3);
});

test("tela Hoje fica limpa quando somente métricas sem exceção estão visíveis", () => {
  const snapshot = buildTodaySnapshot({ date: "2026-09-01", dailySales: { count: 0, total: 0, margin: 0, pending: 0 } });
  assert.equal(snapshot.clear, true);
  assert.equal(snapshot.groups.length, 0);
  assert.equal(snapshot.summary.length, 2);
});

test("tela Hoje só sinaliza divergência depois de comparar esperado e contado", () => {
  const unchecked = buildTodaySnapshot({ date: "2026-09-01", cash: { enabled: true, expected: 150, counted: null, difference: null } });
  assert.equal(unchecked.groups.find((group) => group.id === "cash").title, "Caixa ainda não conferido");
  const checked = buildTodaySnapshot({ date: "2026-09-01", cash: { enabled: true, expected: 150, counted: 145, difference: -5 } });
  assert.equal(checked.summary.find((item) => item.id === "cash").tone, "danger");
  assert.equal(checked.groups.find((group) => group.id === "cash").title, "Divergência de caixa");
});
