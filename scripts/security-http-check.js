import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(existsSync(join(root, ".next", "BUILD_ID")), "Run npm run build first");
// Do not load .env files or inherit external-service credentials in the child.
assert.ok(![".env", ".env.local", ".env.production", ".env.production.local"].some(name => existsSync(join(root, name))), "Run in a clean checkout without .env files");
const directory = mkdtempSync(join(tmpdir(), "candtech-http-security-"));
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../${specifier.slice(2)}.js`, import.meta.url).href, context);
  return next(specifier, context);
} });
let child;
let childExit;
let db;
let passed = 0;
try {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "fixture.sqlite");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  process.env.BILLING_ENFORCEMENT_ENABLED = "false";
  process.env.VERCEL_ENV = "preview";
  delete process.env.DATABASE_URL;
  db = await import("../lib/db.js");
  const { createToken } = await import("../lib/auth.js");
  const users = [];
  const tokens = [];
  const documents = [];
  for (let index = 0; index < 3; index++) {
    const user = await db.createUser({ name: `HTTP fixture ${index}`, email: `http-${index}@test.local`, passwordHash: "fixture-only", accountType: "company" });
    const organization = await db.ensureOwnedOrganization({ userId: user.id, name: user.name });
    documents.push(await db.createHistory({ userId: user.id, organizationId: organization.organizationId, title: `HTTP private ${index}`, calculationType: "VPL", payload: {} }));
    users.push(user);
    tokens.push(await createToken(user));
  }
  const backend = await db.getDatabaseBackend();
  assert.equal(backend.type, "sqlite");
  backend.db.prepare("UPDATE users SET email_verification_required=0").run();
  await db.closeDatabaseForTests();
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://localhost:${port}`;
  const childEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[key]) childEnv[key] = process.env[key];
  Object.assign(childEnv, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", SQLITE_DATABASE_PATH: process.env.SQLITE_DATABASE_PATH, JWT_SECRET: process.env.JWT_SECRET, VERCEL_ENV: "preview", BILLING_ENFORCEMENT_ENABLED: "false" });
  child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "localhost", "--port", String(port)], { cwd: root, env: childEnv, windowsHide: true, stdio: "ignore" });
  childExit = once(child, "exit");
  const call = (path, token, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...(token ? { cookie: `finsight_token=${token}` } : {}), ...options.headers }, signal: AbortSignal.timeout(10000), redirect: "manual" });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(child.exitCode, null, "Local server stopped before readiness");
    try { const response = await call("/api/workspace"); if (response.status === 401) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.ok(ready, "Local server readiness timeout");
  const check = (condition, message) => { assert.ok(condition, message); passed++; };
  for (const path of ["/api/workspace", "/api/inventory", "/api/services", "/api/team", "/api/admin/staff", "/api/account/export"]) {
    const response = await call(path);
    check(response.status === 401, `${path}: anonymous denied`);
    check(/no-store/.test(response.headers.get("cache-control") || ""), `${path}: private errors not cached`);
    check(response.headers.get("x-content-type-options") === "nosniff", `${path}: nosniff`);
  }
  for (let index = 0; index < 3; index++) {
    const response = await call("/api/history", tokens[index]);
    check(response.status === 200, "authenticated history readable");
    check(/no-store/.test(response.headers.get("cache-control") || ""), "authenticated history not cached");
    const text = await response.text();
    check(text.includes(documents[index].id), "own history visible");
    for (let other = 0; other < 3; other++) if (other !== index) {
      check(!text.includes(documents[other].id), "foreign history absent");
      const denied = await call(`/api/history/${documents[other].id}`, tokens[index], { method: "DELETE", headers: { origin: base } });
      check(denied.status === 404, `foreign delete denied: expected 404, received ${denied.status}, ${await denied.text()}`);
    }
  }
  check((await call("/api/workspace", tokens[0], { method: "PUT", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: '{"payload":{}}' })).status === 403, "cross-origin mutation denied");
  const mfa = await call("/api/team", tokens[0]);
  check(mfa.status === 403 && (await mfa.json()).code === "MFA_REQUIRED", "owner must verify MFA to manage team");
  const { getSession, revokeSession } = await import("../lib/auth.js");
  await revokeSession(await getSession({ cookies: { get: () => ({ value: tokens[0] }) } }));
  check((await call("/api/history", tokens[0])).status === 401, "revoked session denied over HTTP");
  console.log(JSON.stringify({ status: "passed", assertions: passed, users: users.length, database: "temporary SQLite", transport: "HTTP / compiled Next.js", productionTested: false }));
} finally {
  if (child && child.exitCode === null) { child.kill(); await childExit; }
  if (db) await db.closeDatabaseForTests();
  hooks.deregister();
  // directory is the exact mkdtemp-created fixture, never a workspace path.
  rmSync(directory, { recursive: true, force: true });
}
