import test from "node:test";
import assert from "node:assert/strict";
import {
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
