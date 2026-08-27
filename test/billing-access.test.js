import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBillingAccess } from "../lib/billing-access.js";
import {
  acceptOrganizationInvitation, closeDatabaseForTests, createOrganizationInvitation, createUser,
  ensureOwnedOrganization,
} from "../lib/db.js";
import { createOrGetPixPaymentRequest, resetPixSchemaForTests, reviewPixPayment, savePixPaymentReceipt } from "../lib/pix-db.js";

test("pagamento do proprietário libera a equipe e a trava pode ser ativada com segurança", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-billing-access-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  const previousEnforcement = process.env.BILLING_ENFORCEMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "billing.sqlite");
  process.env.BILLING_ENFORCEMENT_ENABLED = "true";
  try {
    const owner = await createUser({ name: "Empresa", email: "owner@billing.test", passwordHash: "hash", accountType: "company" });
    const employee = await createUser({ name: "Funcionário", email: "employee@billing.test", passwordHash: "hash" });
    const personal = await createUser({ name: "Pessoal", email: "personal@billing.test", passwordHash: "hash" });
    const organization = await ensureOwnedOrganization({ userId: owner.id, name: "Empresa" });
    await createOrganizationInvitation({
      organizationId: organization.organizationId, email: employee.email, role: "attendant", permissions: ["inventory"],
      tokenHash: "9".repeat(64), invitedBy: owner.id, expiresAt: new Date(Date.now() + 60_000),
    });
    await acceptOrganizationInvitation({ tokenHash: "9".repeat(64), userId: employee.id, email: employee.email });

    assert.equal((await getBillingAccess(owner.id)).active, false);
    assert.equal((await getBillingAccess(personal.id)).active, false);
    const request = await createOrGetPixPaymentRequest(owner.id);
    await savePixPaymentReceipt({
      id: request.payment.id, userId: owner.id, organizationId: organization.organizationId,
      storageKey: "local:22222222-2222-4222-8222-222222222222.pdf", originalFilename: "pix.pdf",
      contentType: "application/pdf", sizeBytes: 100, sha256: "b".repeat(64),
    });
    await reviewPixPayment({ id: request.payment.id, approved: true, administratorId: owner.id });
    const employeeAccess = await getBillingAccess(employee.id);
    assert.equal(employeeAccess.active, true);
    assert.equal(employeeAccess.ownerUserId, owner.id);
    assert.equal(employeeAccess.isBillingOwner, false);

    process.env.BILLING_ENFORCEMENT_ENABLED = "false";
    assert.equal((await getBillingAccess(personal.id)).active, true);
  } finally {
    await closeDatabaseForTests();
    resetPixSchemaForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    if (previousEnforcement === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED; else process.env.BILLING_ENFORCEMENT_ENABLED = previousEnforcement;
    rmSync(directory, { recursive: true, force: true });
  }
});
