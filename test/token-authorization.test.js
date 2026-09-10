import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT, decodeJwt } from "jose";

// Resolve only the application's aliases; execute real auth, DB and access code.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../${specifier.slice(2)}.js`, import.meta.url).href, context);
  if (specifier === "next/server") return next("next/server.js", context);
  return next(specifier, context);
} });
const db = await import("../lib/db.js");
const { createToken, getSession, revokeSession } = await import("../lib/auth.js");
const { getAccessibleHistory, requirePermission } = await import("../lib/organization-access.js");
const { hasVerifiedMfa } = await import("../lib/mfa-access.js");
const { DELETE: deleteHistoryRoute } = await import("../app/api/history/[id]/route.js");
const { GET: teamRoute } = await import("../app/api/team/route.js");
const { GET: readWorkspace, PUT: writeWorkspace } = await import("../app/api/workspace/route.js");
const { GET: readInventory, POST: writeInventory } = await import("../app/api/inventory/route.js");
const { GET: readServices } = await import("../app/api/services/route.js");
const { GET: readAdminStaff } = await import("../app/api/admin/staff/route.js");
const { GET: exportAccount } = await import("../app/api/account/export/route.js");
const { GET: listBackupAccounts, POST: sendBackup } = await import("../app/api/admin/account-backups/route.js");
const { TERMS_VERSION, PRIVACY_VERSION } = await import("../lib/legal.js");
const { unzipSync, strFromU8 } = await import("fflate");
const { createInventoryProducts, listInventory } = await import("../lib/inventory-db.js");
const { NextRequest } = await import("next/server.js");

test("tokens reais: identidade, adulteração, expiração, revogação e isolamento de seis usuários", async (t) => {
  const keys = ["NODE_ENV", "SQLITE_DATABASE_PATH", "DATABASE_URL", "JWT_SECRET", "VERCEL_ENV", "BILLING_ENFORCEMENT_ENABLED"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const directory = mkdtempSync(join(tmpdir(), "candtech-token-isolation-"));
  Object.assign(process.env, { NODE_ENV: "test", SQLITE_DATABASE_PATH: join(directory, "test.sqlite"), JWT_SECRET: randomBytes(32).toString("hex"), VERCEL_ENV: "preview", BILLING_ENFORCEMENT_ENABLED: "false" });
  delete process.env.DATABASE_URL;
  const request = token => ({ url: "http://localhost/api/history", method: "DELETE", headers: new Headers({ origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": "127.0.0.1" }), cookies: { get: name => name === "finsight_token" && token ? { value: token } : undefined } });
  const sign = (payload, algorithm = "HS256", key = process.env.JWT_SECRET) => new SignJWT(payload).setProtectedHeader({ alg: algorithm }).sign(new TextEncoder().encode(key));
  const apiRequest = (token, path, { method = "GET", body, headers = {} } = {}) => new NextRequest(`http://localhost${path}`, {
    method, headers: { origin: "http://localhost", "content-type": "application/json", ...(token ? { cookie: `finsight_token=${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  try {
    const users = [];
    for (let index = 0; index < 6; index++) {
      const user = await db.createUser({ name: `Synthetic ${index}`, email: `token-${index}@test.local`, passwordHash: "not-a-login-password", accountType: index < 3 ? "company" : "person" });
      users.push(user);
    }
    const backend = await db.getDatabaseBackend();
    assert.equal(backend.type, "sqlite", "never run this fixture against production");
    backend.db.prepare("UPDATE users SET email_verification_required=0").run();
    const organizations = [];
    for (const user of users.slice(0, 3)) organizations.push(await db.ensureOwnedOrganization({ userId: user.id, name: user.name }));
    for (let index = 3; index < 6; index++) {
      const tokenHash = randomUUID();
      await db.createOrganizationInvitation({ organizationId: organizations[index - 3].organizationId, email: users[index].email, role: "attendant", permissions: ["history", "calculator"], tokenHash, invitedBy: users[index - 3].id, expiresAt: new Date(Date.now() + 60000) });
      assert.ok(await db.acceptOrganizationInvitation({ tokenHash, userId: users[index].id, email: users[index].email }));
    }
    const tokens = await Promise.all(users.map(user => createToken(user)));
    const claims = decodeJwt(tokens[0]);
    await t.test("cookie contém somente claims de identificação e validade, sem perfil pessoal", async () => {
      for (let index = 0; index < tokens.length; index++) {
        const payload = decodeJwt(tokens[index]);
        assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "jti", "sub"]);
        assert.equal(payload.sub, String(users[index].id));
        const session = await getSession(request(tokens[index]));
        assert.equal(session.name, users[index].name);
        assert.equal(session.email, users[index].email);
      }
      // Sessões anteriores à minimização continuam funcionando até expirar.
      assert.equal((await getSession(request(await sign({ ...claims, name: "Old name", email: "old@test.local", accountType: "person" })))).email, users[0].email);
    });
    const documents = [];
    for (let index = 0; index < 3; index++) documents.push(await db.createHistory({ userId: users[index].id, organizationId: organizations[index].organizationId, title: `Private ${index}`, calculationType: "VPL", payload: {} }));

    await t.test("ZIP exige proprietário e MFA e ignora empresa fornecida pelo navegador", async () => {
      assert.equal((await exportAccount(apiRequest(null, "/api/account/export"))).status, 401);
      assert.equal((await exportAccount(apiRequest(tokens[3], "/api/account/export"))).status, 403);
      assert.equal((await exportAccount(apiRequest(tokens[0], "/api/account/export"))).status, 403);
      await db.savePendingUserMfa({ userId: users[0].id, encryptedSecret: "synthetic-not-a-real-secret", expiresAt: new Date(Date.now() + 60000) });
      assert.equal(await db.enableUserMfa({ userId: users[0].id, recoveryCodeHashes: [] }), true);
      const verified = await createToken(users[0], { mfaVerified: true });
      const response = await exportAccount(apiRequest(verified, `/api/account/export?userId=${users[1].id}&organizationId=${organizations[1].organizationId}`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/zip");
      assert.match(response.headers.get("cache-control"), /no-store/);
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const data = JSON.parse(strFromU8(files["backup-candtech.json"]));
      assert.equal(data.owner.email, users[0].email);
      assert.equal(data.organization.id, organizations[0].organizationId);
      assert.ok(!JSON.stringify(data).includes(users[1].email));
      assert.ok(!JSON.stringify(data).includes("synthetic-not-a-real-secret"));
      assert.ok(!JSON.stringify(data).includes(verified));
      assert.ok(files["LEIA-ME.txt"]);
      await revokeSession(await getSession(request(verified)));
      assert.equal((await exportAccount(apiRequest(verified, "/api/account/export"))).status, 401);
    });

    await t.test("central: somente raiz com MFA envia ZIP ao titular verificado; repetição não reenvia", async () => {
      const savedAdmin = process.env.ADMIN_EMAILS;
      const savedKey = process.env.RESEND_API_KEY;
      const savedFrom = process.env.AUTH_EMAIL_FROM;
      const savedFetch = global.fetch;
      try {
        assert.equal((await listBackupAccounts(apiRequest(null, "/api/admin/account-backups"))).status, 401);
        assert.equal((await listBackupAccounts(apiRequest(tokens[3], "/api/admin/account-backups"))).status, 403);
        process.env.ADMIN_EMAILS = users[0].email;
        process.env.RESEND_API_KEY = "synthetic-test-only";
        process.env.AUTH_EMAIL_FROM = "test@example.test";
        backend.db.prepare("UPDATE users SET legal_accepted_at=CURRENT_TIMESTAMP, terms_version=?, privacy_version=? WHERE id=?").run(TERMS_VERSION, PRIVACY_VERSION, users[0].id);
        const rootToken = await createToken(users[0], { mfaVerified: true });
        const key = randomUUID();
        const call = body => apiRequest(rootToken, "/api/admin/account-backups", { method: "POST", headers: { "idempotency-key": key }, body });
        const page = await listBackupAccounts(apiRequest(rootToken, "/api/admin/account-backups?active=1"));
        assert.equal(page.status, 200);
        assert.ok((await page.json()).accounts.some(a => a.company === organizations[1].organizationName || a.id === users[1].id));
        assert.equal((await sendBackup(call({ userId: users[1].id, confirm: true, email: "outsider@example.test" }))).status, 400);
        assert.equal((await sendBackup(call({ userId: users[1].id, confirm: true }))).status, 409);
        backend.db.prepare("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(users[1].id);
        let sends = 0;
        global.fetch = async (_url, options) => {
          sends++;
          const body = JSON.parse(options.body);
          assert.deepEqual(body.to, [users[1].email]);
          const files = unzipSync(new Uint8Array(Buffer.from(body.attachments[0].content, "base64")));
          const exported = JSON.parse(strFromU8(files["backup-candtech.json"]));
          assert.equal(exported.owner.email, users[1].email);
          return { ok: true };
        };
        assert.equal((await sendBackup(call({ userId: users[1].id, confirm: true }))).status, 202);
        // A rota limita envios; limpa apenas os contadores sintéticos desta fixture para testar replay.
        backend.db.prepare("DELETE FROM rate_limits").run();
        assert.equal((await sendBackup(call({ userId: users[1].id, confirm: true }))).status, 202);
        assert.equal(sends, 1);
      } finally {
        global.fetch = savedFetch;
        for (const [key, value] of [["ADMIN_EMAILS", savedAdmin], ["RESEND_API_KEY", savedKey], ["AUTH_EMAIL_FROM", savedFrom]]) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    });

    await t.test("seis identidades e 18 combinações de usuário/documento", async () => {
      for (let index = 0; index < 6; index++) {
        const user = await getSession(request(tokens[index]));
        assert.equal(user.id, users[index].id);
        for (let doc = 0; doc < 3; doc++) {
          const result = await getAccessibleHistory({ user, id: documents[doc].id });
          assert.equal(Boolean(result.item), index % 3 === doc, `user ${index}, document ${doc}`);
        }
      }
    });
    await t.test("sem cookie, assinatura falsa, algoritmo indevido e identidade trocada são negados", async () => {
      assert.equal(await getSession(request()), null);
      assert.equal(await getSession(request("not-a-jwt")), null);
      const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;
      assert.equal(await getSession(request(unsigned)), null);
      assert.equal(await getSession(request(await sign(claims, "HS256", "wrong-test-key"))), null);
      assert.equal(await getSession(request(await sign(claims, "HS384"))), null);
      assert.equal(await getSession(request(await sign({ ...claims, sub: String(users[1].id) }))), null);
      assert.equal(await getSession(request(await sign({ ...claims, jti: randomUUID() }))), null);
      const parts = tokens[0].split(".");
      parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: String(users[1].id) })).toString("base64url");
      assert.equal(await getSession(request(parts.join("."))), null);
    });
    await t.test("handlers reais: exclusão cruzada negada e gestão exige proprietário com MFA", async () => {
      assert.equal((await deleteHistoryRoute(request(), { params: Promise.resolve({ id: documents[0].id }) })).status, 401);
      for (let index = 0; index < 6; index++) {
        const foreign = documents[(index % 3 + 1) % 3];
        assert.equal((await deleteHistoryRoute(request(tokens[index]), { params: Promise.resolve({ id: foreign.id }) })).status, 404);
      }
      assert.equal((await teamRoute(request(tokens[3]))).status, 403);
      const ownerResponse = await teamRoute(request(tokens[0]));
      assert.equal(ownerResponse.status, 403);
      assert.equal((await ownerResponse.json()).code, "MFA_REQUIRED");
      for (let index = 0; index < 3; index++) assert.ok(await db.findHistoryById(documents[index].id, users[index].id, organizations[index].organizationId));
    });
    await t.test("expiração e campos obrigatórios do token", async () => {
      assert.equal(await getSession(request(await sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }))), null);
      for (const field of ["exp", "iat", "sub", "jti"]) {
        const incomplete = { ...claims }; delete incomplete[field];
        assert.equal(await getSession(request(await sign(incomplete))), null, `missing ${field}`);
      }
    });
    await t.test("APIs privadas negam anônimo e áreas sem permissão", async () => {
      for (const [path, handler] of [["/api/workspace", readWorkspace], ["/api/inventory", readInventory], ["/api/services", readServices], ["/api/admin/staff", readAdminStaff]]) {
        assert.equal((await handler(apiRequest(null, path))).status, 401, path);
      }
      assert.equal((await readInventory(apiRequest(tokens[3], "/api/inventory"))).status, 403);
      assert.equal((await readServices(apiRequest(tokens[3], "/api/services"))).status, 403);
      assert.equal((await readAdminStaff(apiRequest(tokens[0], "/api/admin/staff"))).status, 403);
    });
    await t.test("workspace ignora proprietário enviado e protege campos do financeiro", async () => {
      for (let index = 0; index < 3; index++) await db.saveWorkspace({ userId: users[index].id, organizationId: organizations[index].organizationId, payload: { organizationName: `Private company ${index}`, inputs: { rate: "1" } } });
      const response = await writeWorkspace(apiRequest(tokens[0], "/api/workspace", { method: "PUT", body: { userId: users[1].id, ownerUserId: users[1].id, organizationId: organizations[1].organizationId, payload: { organizationName: "Own change" } } }));
      assert.equal(response.status, 200);
      assert.equal((await db.getWorkspace(users[1].id, organizations[1].organizationId)).payload.organizationName, "Private company 1");
      assert.equal((await db.getWorkspace(users[0].id, organizations[0].organizationId)).payload.organizationName, "Own change");
      const staffRead = await readWorkspace(apiRequest(tokens[3], `/api/workspace?ownerUserId=${users[1].id}`));
      assert.equal((await staffRead.json()).workspace.payload.organizationName, undefined);
      assert.equal((await writeWorkspace(apiRequest(tokens[3], "/api/workspace", { method: "PUT", body: { payload: { organizationName: "Forbidden change", inputs: { rate: "2" } } } }))).status, 200);
      const saved = await db.getWorkspace(users[0].id, organizations[0].organizationId);
      assert.equal(saved.payload.organizationName, "Own change");
      assert.equal(saved.payload.inputs.rate, "2");
    });
    await t.test("CSRF, conteúdo inválido, excesso de bytes e prototype pollution bloqueados", async () => {
      for (const [headers, body, expected] of [
        [{ origin: "https://untrusted.example" }, { payload: {} }, 403],
        [{ "sec-fetch-site": "cross-site" }, { payload: {} }, 403],
        [{ "content-type": "text/plain" }, { payload: {} }, 415],
        [{ "content-length": "512001" }, { payload: {} }, 413],
        [{}, '{"payload":{"__proto__":{"polluted":true}}}', 400],
        [{}, "{invalid", 400],
      ]) assert.equal((await writeWorkspace(apiRequest(tokens[0], "/api/workspace", { method: "PUT", headers, body }))).status, expected);
      assert.equal({}.polluted, undefined);
    });
    await t.test("alertas de estoque: IDOR, permissão, replay e conflito", async () => {
      const tenantA = `organization:${organizations[0].organizationId}`;
      const tenantB = `organization:${organizations[1].organizationId}`;
      const [product] = await createInventoryProducts({ tenantId: tenantB, products: [{ name: "Private product", category: "Test", unit: "un", variants: [{ name: "Default", sku: "PRIVATE-B", minimumQuantity: 1, unitCost: 10, salePrice: 20, location: "" }] }] });
      const body = { action: "update-alert", variantId: product.variants[0].id, minimumQuantity: 7, restockReminderOn: "2027-01-01", tenantId: tenantB, organizationId: organizations[1].organizationId };
      const headers = { "idempotency-key": randomUUID() };
      assert.equal((await writeInventory(apiRequest(tokens[3], "/api/inventory", { method: "POST", headers, body }))).status, 403);
      assert.equal((await writeInventory(apiRequest(tokens[0], "/api/inventory", { method: "POST", headers, body }))).status, 404);
      assert.equal((await listInventory(tenantB)).products[0].variants[0].minimumQuantity, 1);
      assert.equal((await listInventory(tenantA)).products.length, 0);
      const ownHeaders = { "idempotency-key": randomUUID() };
      const send = data => writeInventory(apiRequest(tokens[1], "/api/inventory", { method: "POST", headers: ownHeaders, body: data }));
      assert.equal((await send(body)).status, 200);
      const replay = await send(body);
      assert.equal(replay.status, 200);
      assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
      assert.equal((await send({ ...body, minimumQuantity: 9 })).status, 409);
      assert.equal((await listInventory(tenantB)).products[0].variants[0].minimumQuantity, 7);
    });
    await t.test("claims não elevam perfil nem MFA; permissões são relidas com o mesmo token", async () => {
      const staff = await getSession(request(await sign({ ...decodeJwt(tokens[3]), email: users[0].email, accountType: "company", role: "owner", mfaVerified: true })));
      assert.equal(staff.email, users[3].email);
      assert.equal(hasVerifiedMfa(staff), false);
      assert.equal(await requirePermission(staff, "cashflow"), null);
      assert.ok(await requirePermission(staff, "history"));
      await db.updateOrganizationMember({ organizationId: organizations[0].organizationId, userId: staff.id, role: "attendant", permissions: [] });
      assert.equal(await requirePermission(await getSession(request(tokens[3])), "history"), null);
      await db.updateOrganizationMember({ organizationId: organizations[0].organizationId, userId: staff.id, role: "attendant", permissions: ["history", "calculator"], status: "suspended" });
      assert.equal((await getAccessibleHistory({ user: await getSession(request(tokens[3])), id: documents[0].id })).item, null);
    });
    await t.test("e-mail e assinatura são conferidos no servidor", async () => {
      backend.db.prepare("UPDATE users SET email_verification_required=1, email_verified_at=NULL WHERE id=?").run(users[1].id);
      assert.equal(await getSession(request(tokens[1])), null);
      process.env.BILLING_ENFORCEMENT_ENABLED = "true";
      assert.equal(await getSession(request(tokens[0])), null);
      assert.ok(await getSession(request(tokens[0]), { allowInactiveSubscription: true }));
      process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    });
    await t.test("suspender a conta bloqueia token existente mesmo nas rotas de regularização", async () => {
      assert.ok(await getSession(request(tokens[4])));
      backend.db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(users[4].id);
      assert.equal(await getSession(request(tokens[4])), null);
      assert.equal(await getSession(request(tokens[4]), { allowUnverified: true, allowInactiveSubscription: true }), null);
      assert.equal((await readWorkspace(apiRequest(tokens[4], "/api/workspace"))).status, 401);
    });
    await t.test("logout revoga token e expiração do banco também bloqueia", async () => {
      await revokeSession(await getSession(request(tokens[0])));
      assert.equal(await getSession(request(tokens[0])), null);
      backend.db.prepare("UPDATE auth_sessions SET expires_at='2000-01-01' WHERE user_id=?").run(users[2].id);
      assert.equal(await getSession(request(tokens[2])), null);
    });
  } finally {
    await db.closeDatabaseForTests();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    hooks.deregister();
    rmSync(directory, { recursive: true, force: true });
  }
});
