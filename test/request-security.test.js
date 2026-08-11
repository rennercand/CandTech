import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readLimitedJson, RequestBodyError } from "../lib/request-security.js";
import { ANALYTICS_CONSENT_KEY, trackMarketingEvent } from "../lib/analytics.js";
import nextConfig from "../next.config.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.js" ? [path] : [];
  });
}

test("leitor JSON aceita corpo pequeno e rejeita excesso mesmo sem Content-Length", async () => {
  const valid = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.com" }),
  });
  assert.deepEqual(await readLimitedJson(valid, { maxBytes: 128 }), { email: "a@b.com" });

  const oversized = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(200) }),
  });
  await assert.rejects(() => readLimitedJson(oversized, { maxBytes: 64 }), (error) => error instanceof RequestBodyError && error.status === 413);
});

test("leitor JSON limita profundidade e chaves perigosas", async () => {
  const deep = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: { b: { c: 1 } } }),
  });
  await assert.rejects(() => readLimitedJson(deep, { maxDepth: 1 }), RequestBodyError);

  const unsafe = new Request("http://localhost/api", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"constructor":"blocked"}',
  });
  await assert.rejects(() => readLimitedJson(unsafe), RequestBodyError);
});

test("toda API privada exige sessão JWT no servidor", () => {
  const stripeWebhook = join("app", "api", "stripe", "webhook", "route.js");
  const publicRoutes = new Set([
    join("app", "api", "auth", "login", "route.js"),
    join("app", "api", "auth", "register", "route.js"),
    join("app", "api", "auth", "forgot-password", "route.js"),
    join("app", "api", "auth", "reset-password", "route.js"),
    join("app", "api", "auth", "verify-email", "route.js"),
    // A prévia usa um token aleatório, limita requisições e nunca retorna o
    // e-mail completo, IDs ou dados da empresa.
    join("app", "api", "team", "invitation", "preview", "route.js"),
    // A Stripe não possui a sessão do usuário; o webhook usa corpo bruto,
    // segredo exclusivo e assinatura com proteção temporal contra replay.
    stripeWebhook,
  ]);
  for (const file of routeFiles(join(projectRoot, "app", "api"))) {
    const route = relative(projectRoot, file);
    const source = readFileSync(file, "utf8");
    if (route === stripeWebhook) {
      assert.match(source, /request\.text\s*\(\)/, "webhook Stripe precisa preservar o corpo bruto");
      assert.match(source, /constructEvent\s*\(/, "webhook Stripe precisa validar a assinatura");
      assert.match(source, /stripe-signature/, "webhook Stripe precisa exigir Stripe-Signature");
    }
    if (publicRoutes.has(route)) continue;
    assert.match(source, /getSession\s*\(/, `${route} precisa validar a sessão JWT`);
  }
});

test("eventos de marketing exigem consentimento e descartam dados pessoais", () => {
  const calls = [];
  global.window = {
    localStorage: { getItem: () => "denied" },
    gtag: (...args) => calls.push(args),
  };
  assert.equal(trackMarketingEvent("sign_up", { method: "email" }), false);
  assert.equal(calls.length, 0);

  global.window.localStorage.getItem = (key) => key === ANALYTICS_CONSENT_KEY ? "granted" : null;
  assert.equal(trackMarketingEvent("sign_up", {
    method: "email", account_type: "company", email: "cliente@exemplo.com", amount: 999,
  }), true);
  assert.deepEqual(calls[0], ["event", "sign_up", { method: "email", account_type: "company" }]);
  assert.equal(trackMarketingEvent("financial_document_saved", { amount: 999 }), false);
  delete global.window;
});

test("CSP permite somente os endpoints necessarios do Google Analytics", async () => {
  const rules = await nextConfig.headers();
  const csp = rules
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;

  assert.match(csp, /script-src[^;]*https:\/\/www\.googletagmanager\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.google-analytics\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*https:\/\/\*/);
});
