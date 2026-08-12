import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

test("fluxo de caixa diferencia movimentos e saldo acumulado", () => {
  const app = readFileSync(join(projectRoot, "app", "candtech-app.js"), "utf8");

  assert.match(app, /function CashBalanceChart/);
  assert.match(app, /Evolução do saldo acumulado/);
  assert.match(app, /O cálculo começa em R\$ 0 no período selecionado/);
  assert.match(app, /<CashBalanceChart rows=\{rowsWithBalance\}/);
});

test("movimentos visuais preservam foco e preferência de acessibilidade", () => {
  const styles = readFileSync(join(projectRoot, "app", "globals.css"), "utf8");

  assert.match(styles, /\.view-stage/);
  assert.match(styles, /button:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.cash-balance-line/);
});
