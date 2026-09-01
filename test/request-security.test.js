import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readLimitedJson, RequestBodyError } from "../lib/request-security.js";
import { ANALYTICS_CONSENT_KEY, trackMarketingEvent } from "../lib/analytics.js";
import nextConfig from "../next.config.mjs";
import { buildContentSecurityPolicy } from "../lib/security-headers.js";
import { validateWorkspacePayload } from "../lib/workspace-validation.js";

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
  const cronPrefix = join("app", "api", "cron") + sep;
  const publicRoutes = new Set([
    join("app", "api", "auth", "login", "route.js"),
    join("app", "api", "auth", "register", "route.js"),
    join("app", "api", "auth", "forgot-password", "route.js"),
    join("app", "api", "auth", "reset-password", "route.js"),
    join("app", "api", "auth", "verify-email", "route.js"),
    // Conclui a autenticação com um desafio aleatório, expirável, de uso único
    // e limitado a cinco tentativas; a sessão ainda não existe nesta etapa.
    join("app", "api", "auth", "mfa", "verify", "route.js"),
    // A prévia usa um token aleatório, limita requisições e nunca retorna o
    // e-mail completo, IDs ou dados da empresa.
    join("app", "api", "team", "invitation", "preview", "route.js"),
  ]);
  for (const file of routeFiles(join(projectRoot, "app", "api"))) {
    const route = relative(projectRoot, file);
    const source = readFileSync(file, "utf8");
    if (route.startsWith(cronPrefix)) {
      assert.match(source, /CRON_SECRET/, "cron precisa exigir segredo próprio");
      continue;
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
  assert.deepEqual(calls[0], ["event", "sign_up", { method: "email" }]);
  assert.equal(trackMarketingEvent("financial_document_saved", { amount: 999 }), false);
  delete global.window;
});

test("revogação do Analytics cobre o host e o domínio principal", () => {
  const source = readFileSync(join(projectRoot, "app", "analytics-consent.js"), "utf8");
  const policy = readFileSync(join(projectRoot, "app", "cookies", "page.js"), "utf8");
  assert.match(source, /Domain=\.candtech\.com\.br/);
  assert.match(policy, new RegExp(ANALYTICS_CONSENT_KEY));
});

test("CSP usa nonce por requisição e permite somente os endpoints necessários do Analytics", () => {
  const csp = buildContentSecurityPolicy("nonceSeguro1234567890", { development: false });

  assert.match(csp, /script-src[^;]*'nonce-nonceSeguro1234567890'/);
  assert.match(csp, /script-src[^;]*'strict-dynamic'/);
  assert.match(csp, /script-src[^;]*https:\/\/www\.googletagmanager\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.google-analytics\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*https:\/\/\*/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /style-src (?![^;]*-attr)[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /unsafe-eval/, "produção e testes não devem liberar eval");
});

test("workspace rejeita sintaxe de caminho e mantém nomes comerciais normais", () => {
  assert.equal(validateWorkspacePayload({ organizationName: "Padaria São José", cashEntries: [] }), true);
  assert.equal(validateWorkspacePayload({ organizationName: "../etc/passwd" }), false);
  assert.equal(validateWorkspacePayload({ organizationName: "..\\segredos\\arquivo" }), false);
  assert.equal(validateWorkspacePayload({ organizationName: "%2e%2e%2f.env" }), false);
  assert.equal(validateWorkspacePayload({ organizationName: "C:\\Windows\\win.ini" }), false);
  assert.equal(validateWorkspacePayload({ organizationName: "Loja\u0000Oculta" }), false);
});

test("workspace aceita taxas numéricas e rejeita injeção no campo rate", () => {
  assert.equal(validateWorkspacePayload({ inputs: { rate: "1.5" } }), true);
  assert.equal(validateWorkspacePayload({ financeState: { form: { rate: 2 } } }), true);
  assert.equal(validateWorkspacePayload({ inputs: { rate: "" } }), true);
  assert.equal(validateWorkspacePayload({ inputs: { rate: "' OR '1'='1'--" } }), false);
  assert.equal(validateWorkspacePayload({ financeState: { form: { rate: "1; DROP TABLE users" } } }), false);
});

test("logout remove a sessão repetindo Secure, HttpOnly e SameSite", () => {
  const route = readFileSync(join(projectRoot, "app", "api", "auth", "me", "route.js"), "utf8");
  assert.match(route, /\.\.\.authCookie/);
  assert.match(route, /maxAge:\s*0/);
  assert.match(route, /expires:\s*new Date\(0\)/);
});

test("gravação do workspace não reflete o payload enviado", () => {
  const route = readFileSync(join(projectRoot, "app", "api", "workspace", "route.js"), "utf8");
  assert.match(route, /return NextResponse\.json\(\{ saved: true \}\)/);
  assert.doesNotMatch(route, /savedWorkspaceMetadata/);
  assert.doesNotMatch(route, /return NextResponse\.json\(\{ workspace: \{ \.\.\.workspace, payload:/);
});

test("APIs e central administrativa nunca permitem cache compartilhado", async () => {
  const rules = await nextConfig.headers();
  for (const source of ["/api/:path*", "/central/:path*"]) {
    const rule = rules.find((item) => item.source === source);
    const cacheControl = rule?.headers.find((header) => header.key === "Cache-Control")?.value;
    assert.equal(cacheControl, "private, no-store, max-age=0", `${source} precisa bloquear cache privado`);
  }
});

test("cadastro informa claramente quando o e-mail já possui conta", () => {
  const route = readFileSync(join(projectRoot, "app", "api", "auth", "register", "route.js"), "utf8");
  const interfaceSource = readFileSync(join(projectRoot, "app", "candtech-app.js"), "utf8");
  assert.match(route, /EMAIL_ALREADY_REGISTERED/);
  assert.match(route, /Já existe uma conta criada com este e-mail/);
  assert.match(route, /status:\s*409/);
  assert.match(route, /findUserByEmail\(cleanEmail\)/);
  assert.match(interfaceSource, /errorCode === "EMAIL_ALREADY_REGISTERED"/);
  assert.match(interfaceSource, /Esta conta já foi criada/);
  assert.match(interfaceSource, /role="alert"/);
  assert.match(interfaceSource, /Recuperar senha/);
});

test("menu lateral mantém conta e saída dentro da altura visível", () => {
  const styles = readFileSync(join(projectRoot, "app", "globals.css"), "utf8");
  assert.match(styles, /\.sidebar\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.sidebar\s*\{[^}]*height:\s*100dvh/s);
  assert.match(styles, /\.sidebar nav\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.sidebar-bottom\s*\{[^}]*flex:\s*0 0 auto/s);
});
