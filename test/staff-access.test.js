import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser, getDatabaseBackend } from "../lib/db.js";
import { getAdministratorAccess } from "../lib/admin-access.js";
import { getStaffAccessByUserId, listStaffAccess, revokeStaffAccess, saveStaffAccessByEmail } from "../lib/staff-db.js";

async function isolatedDatabase(run) {
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  const previousAdmins = process.env.ADMIN_EMAILS;
  const directory = mkdtempSync(join(tmpdir(), "candtech-staff-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "staff.sqlite");
  process.env.ADMIN_EMAILS = "root@candtech.test";
  try { await run(); } finally {
    await closeDatabaseForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previousAdmins;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("equipe interna recebe somente os módulos concedidos e o root mantém a gestão", async () => isolatedDatabase(async () => {
  const root = await createUser({ name: "Root", email: "root@candtech.test", passwordHash: "hash" });
  const support = await createUser({ name: "Suporte", email: "support@candtech.test", passwordHash: "hash" });
  const billing = await createUser({ name: "Cobrança", email: "billing@candtech.test", passwordHash: "hash" });
  const outsider = await createUser({ name: "Cliente", email: "client@candtech.test", passwordHash: "hash" });

  const backend = await getDatabaseBackend();
  backend.db.prepare("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP, email_verification_required=0 WHERE id IN (?, ?, ?)")
    .run(root.id, support.id, billing.id);

  assert.deepEqual(await getAdministratorAccess(root), {
    isStaff: true, isRoot: true, canMonitor: true, canSupport: true, canBilling: true, canManageStaff: true,
    canViewSystemOverview: false,
  });
  assert.equal((await getAdministratorAccess(outsider)).isStaff, false);

  await saveStaffAccessByEmail({ email: support.email, canMonitor: false, canSupport: true, canBilling: false, grantedBy: root.id });
  await saveStaffAccessByEmail({ email: billing.email, canMonitor: false, canSupport: false, canBilling: true, grantedBy: root.id });
  const supportAccess = await getAdministratorAccess(support);
  const billingAccess = await getAdministratorAccess(billing);
  assert.equal(supportAccess.canSupport, true);
  assert.equal(supportAccess.canBilling, false);
  assert.equal(supportAccess.canManageStaff, false);
  assert.equal(billingAccess.canBilling, true);
  assert.equal(billingAccess.canSupport, false);
  assert.equal((await listStaffAccess()).length, 2);

  await revokeStaffAccess(support.id);
  assert.equal(await getStaffAccessByUserId(support.id), null);
  assert.equal((await getAdministratorAccess(support)).isStaff, false);
  assert.equal(await saveStaffAccessByEmail({ email: "missing@candtech.test", canSupport: true, grantedBy: root.id }), null);
  assert.equal(await saveStaffAccessByEmail({ email: outsider.email, canSupport: true, grantedBy: root.id }), null);
}));

test("APIs administrativas aplicam privilégio mínimo no servidor", () => {
  const monitoring = readFileSync(new URL("../app/api/admin/monitoring/route.js", import.meta.url), "utf8");
  const staff = readFileSync(new URL("../app/api/admin/staff/route.js", import.meta.url), "utf8");
  const receipt = readFileSync(new URL("../app/api/admin/payments/[paymentId]/receipt/route.js", import.meta.url), "utf8");
  const audit = readFileSync(new URL("../app/api/admin/audit/route.js", import.meta.url), "utf8");
  const application = readFileSync(new URL("../app/candtech-app.js", import.meta.url), "utf8");
  assert.match(monitoring, /auth\.access\.canMonitor/);
  assert.match(monitoring, /auth\.access\.canSupport/);
  assert.match(monitoring, /auth\.access\.canBilling/);
  assert.match(monitoring, /claimIdempotency\(idempotencyContext\)/);
  assert.match(monitoring, /Idempotency-Key obrigatório ou inválido/);
  assert.match(staff, /access\.canManageStaff/);
  assert.match(staff, /guardMutation\(request\)/);
  assert.match(receipt, /access\.canBilling/);
  assert.match(audit, /access\.isRoot/);
  assert.match(audit, /hasVerifiedMfa\(user\)/);
  assert.match(audit, /Cache-Control.*private, no-store/);
  assert.match(application, /AdministrativeAccessScreen/);
  assert.match(application, /user\.administrator && user\.monitoringPath/);
});
