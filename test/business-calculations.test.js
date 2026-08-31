import test from "node:test";
import assert from "node:assert/strict";
import {
  ordersFromCashEntries,
  suggestFinancialReconciliations,
  summarizeAccounts,
  summarizeInventory,
  summarizeOrders,
} from "../lib/business-calculations.js";

test("contas separam compromissos pendentes e identificam vencimentos", () => {
  const result = summarizeAccounts([
    { type: "pagar", amount: 500, dueDate: "2026-01-01", status: "pendente" },
    { type: "receber", amount: 900, dueDate: "2026-12-01", status: "pendente" },
    { type: "pagar", amount: 200, dueDate: "2026-01-01", status: "pago" },
  ], "2026-08-01");
  assert.deepEqual(result, { payable: 500, receivable: 900, overdue: 1 });
});

test("conciliação sugere vínculos exatos sem alterar contas e exige revisão", () => {
  const entries = [
    { id: "entry-1", date: "2026-08-31", type: "entrada", amount: 180, description: "PIX Cliente Aurora" },
    { id: "entry-2", date: "2026-08-30", type: "saida", amount: 60, description: "Pagamento Fornecedor Sul" },
  ];
  const accounts = [
    { id: "account-1", type: "receber", amount: 180, party: "Cliente Aurora", dueDate: "2026-08-31", status: "pendente" },
    { id: "account-2", type: "pagar", amount: 60, party: "Fornecedor Sul", dueDate: "2026-09-01", status: "pendente" },
  ];
  const original = structuredClone(accounts);
  const suggestions = suggestFinancialReconciliations(entries, accounts, []);
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].targetType, "commitment");
  assert.equal(suggestions[0].confidence, "alta");
  assert.deepEqual(accounts, original);
});

test("conciliação ignora lançamentos já vinculados e não cruza entrada com conta a pagar", () => {
  const entries = [
    { id: "linked", date: "2026-08-31", type: "entrada", amount: 100, description: "Já usado", sourceCommitmentId: "account-a" },
    { id: "wrong-direction", date: "2026-08-31", type: "entrada", amount: 50, description: "Tarifa" },
  ];
  const accounts = [
    { id: "account-a", type: "receber", amount: 100, status: "pendente" },
    { id: "account-b", type: "pagar", amount: 50, status: "pendente" },
  ];
  assert.deepEqual(suggestFinancialReconciliations(entries, accounts, []), []);
});

test("estoque calcula quantidade, custo e alertas sem arredondamento intermediário", () => {
  const result = summarizeInventory({
    products: [{ name: "Produto A", quantity: 3, minimum: 3, unitCost: 12.5 }],
    deliveries: [{ description: "Pedido 1", date: "2026-07-01", status: "em-transito" }],
  }, "2026-08-01");
  assert.equal(result.units, 3);
  assert.equal(result.value, 37.5);
  assert.equal(result.lowStock, 1);
  assert.equal(result.lateDeliveries, 1);
});

test("pedidos cancelados não entram nos totais comerciais", () => {
  const result = summarizeOrders([
    { type: "venda", amount: 1000, partner: "Cliente", status: "confirmado" },
    { type: "compra", amount: 300, partner: "Fornecedor A", status: "confirmado" },
    { type: "compra", amount: 999, partner: "Fornecedor B", status: "cancelado" },
  ], "2026-08-01");
  assert.equal(result.sales, 1000);
  assert.equal(result.purchases, 300);
  assert.equal(result.balance, 700);
  assert.equal(result.suppliers.size, 2);
});

test("extrato sugere vendas e compras editáveis sem duplicar lançamentos", () => {
  const entries = [
    { date: "2026-08-01", type: "entrada", amount: 150, description: "PIX Cliente A" },
    { date: "2026-08-02", type: "saida", amount: 80, description: "PIX Fornecedor B" },
  ];
  const suggestions = ordersFromCashEntries(entries, []);
  assert.equal(suggestions[0].type, "venda");
  assert.equal(suggestions[1].type, "compra");
  assert.equal(suggestions[0].status, "rascunho");
  assert.equal(ordersFromCashEntries(entries, [suggestions[0]]).length, 1);
});
