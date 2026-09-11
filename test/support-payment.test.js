import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Resolve os mesmos aliases do Next para testar a rota real com SQLite isolado.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.js`, import.meta.url).href, context);
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
} });

const { NextRequest } = await import("next/server.js");
const { GET, POST } = await import("../app/api/pix/route.js");
const { createToken } = await import("../lib/auth.js");
const { createUser, getBillingProviderState, getDatabaseBackend, closeDatabaseForTests } = await import("../lib/db.js");
const { resetPixSchemaForTests } = await import("../lib/pix-db.js");

test("pagamento pelo suporte funciona sem chave Pix, isola contas e não libera acesso", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-support-payment-"));
  const keys = ["NODE_ENV", "SQLITE_DATABASE_PATH", "JWT_SECRET", "PIX_KEY", "DATABASE_URL"];
  const previous = keys.map(key => process.env[key]);
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "support.sqlite");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  delete process.env.PIX_KEY;
  delete process.env.DATABASE_URL;
  const request = (token, method = "GET", origin = "http://localhost:3000") => new NextRequest("http://localhost:3000/api/pix", {
    method, headers: { origin, "content-type": "application/json", ...(token ? { cookie: `finsight_token=${token}` } : {}) },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  try {
    assert.equal((await GET(request())).status, 401);
    const user = await createUser({ name: "Teste suporte", email: "support@example.test", passwordHash: "hash" });
    const { db } = await getDatabaseBackend();
    db.prepare("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
    const token = await createToken(user);
    assert.equal((await POST(request(token, "POST", "https://other.example"))).status, 403);
    const first = await POST(request(token, "POST"));
    assert.equal(first.status, 201);
    const data = await first.json();
    assert.equal(data.payment.pixCode, null);
    assert.equal(data.payment.amountCents, 12000);
    assert.equal(data.payment.status, "pending");
    assert.ok(data.contact.email);
    assert.equal((await getBillingProviderState(user.id)).status, "pending_payment");
    const repeated = await POST(request(token, "POST"));
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).payment.id, data.payment.id);
    const own = await (await GET(request(token))).json();
    assert.equal(own.payment.id, data.payment.id);
    assert.equal(own.payment.pixCode, null);
    const other = await createUser({ name: "Outra conta", email: "other-support@example.test", passwordHash: "hash" });
    db.prepare("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(other.id);
    const isolated = await (await GET(request(await createToken(other)))).json();
    assert.equal(isolated.payment, null);
  } finally {
    await closeDatabaseForTests(); resetPixSchemaForTests();
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    rmSync(directory, { recursive: true, force: true });
  }
});
