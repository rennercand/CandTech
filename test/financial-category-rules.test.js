import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCategoryRules, suggestCategory } from "../lib/financial-category-rules.js";

test("regra de categoria ignora acentos e explica a decisão", () => {
  const suggestion = suggestCategory({ description: "Pagamento de ÁGUA", type: "saida" }, [
    { id: "r1", version: 2, term: "agua", category: "Fornecedores", type: "saida" },
  ]);
  assert.deepEqual(suggestion, {
    category: "Fornecedores", ruleId: "r1", ruleVersion: 2,
    explanation: "A descrição contém “agua” e o tipo é saida.",
  });
});

test("ordem, tipo e ativação tornam a categorização determinística", () => {
  const rules = normalizeCategoryRules([
    { id: "off", term: "loja", category: "Outros", active: false },
    { id: "entrada", term: "loja", category: "Vendas", type: "entrada" },
    { id: "saida", term: "loja", category: "Compras", type: "saida" },
  ]);
  assert.equal(suggestCategory({ description: "Loja Central", type: "saida" }, rules).category, "Compras");
});
