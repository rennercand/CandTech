import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportServerError } from "../lib/observability.js";

test("log estruturado remove e-mail, documento, chave e token", () => {
  const original = console.error;
  let output = "";
  console.error = (value) => { output = value; };
  try {
    reportServerError(
      new Error("Falha para cliente@empresa.com CPF 12345678901 com re_abcdefghijk e abcdefghijklmnopqrstuvwxyz123456"),
      { route: "/api/test", operation: "save", status: 500 },
    );
  } finally {
    console.error = original;
  }
  const parsed = JSON.parse(output);
  assert.equal(parsed.message, "server_operation_failed");
  assert.equal(parsed.route, "/api/test");
  assert.doesNotMatch(output, /cliente@empresa|12345678901|re_abcdefghijk|abcdefghijklmnopqrstuvwxyz123456/);
});

test("log de produção não inclui mensagem livre do erro", () => {
  const originalConsole = console.error;
  const originalEnvironment = process.env.NODE_ENV;
  let output = "";
  console.error = (value) => { output = value; };
  process.env.NODE_ENV = "production";
  try {
    reportServerError(new Error("Cliente Loja Exemplo com pedido confidencial"), {
      route: "/api/test", operation: "save",
    });
  } finally {
    console.error = originalConsole;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
  assert.equal(JSON.parse(output).errorMessage, undefined);
  assert.doesNotMatch(output, /Loja Exemplo|pedido confidencial/);
});

test("aplicação possui recuperação local e global de erros", () => {
  const root = process.cwd();
  assert.match(readFileSync(join(root, "app", "error.js"), "utf8"), /Tentar novamente/);
  assert.match(readFileSync(join(root, "app", "global-error.js"), "utf8"), /<html lang="pt-BR">/);
});
