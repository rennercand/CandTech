import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("cadastro público oferece apenas empresa e servidor fixa o tipo independentemente do formulário", () => {
  const ui = readFileSync(new URL("../app/candtech-app.js", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/auth/register/route.js", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /Pessoa física|accountType: "person"/);
  assert.match(ui, /<strong>Empresa<\/strong>/);
  assert.match(ui, /inviteToken \? "Nome completo" : "Responsável pela empresa"/);
  assert.match(route, /const accountType = "company"/);
  assert.doesNotMatch(route, /const \{[^}]*accountType[^}]*\} = await readLimitedJson/);
  assert.match(route, /passwordHash, accountType,/);
});
