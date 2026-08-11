import test from "node:test";
import assert from "node:assert/strict";
import { historyPdf } from "../lib/history-pdf.js";

test("pré-nota comercial gera um PDF válido sem se apresentar como documento fiscal", async () => {
  const pdf = await historyPdf({
    title: "Pré-nota PED-001",
    calculation_type: "pre-nota-produto",
    created_at: "2026-08-06T00:00:00.000Z",
    payload: {
      commercialDocument: {
        number: "PED-001",
        issueDate: "2026-08-06",
        issuer: { legalName: "CandTech Teste", document: "00.000.000/0001-00" },
        customer: { name: "Cliente Teste", contact: "cliente@teste.com" },
        items: [{ description: "Produto A", sku: "SKU-A", quantity: 2, unitPrice: 50, total: 100 }],
        total: 100,
      },
    },
  });

  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 2_000);
});
