import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabaseForTests, createUser, getBillingProviderState } from "../lib/db.js";
import { buildPixPayload } from "../lib/pix.js";
import { createOrGetPixPaymentRequest, resetPixSchemaForTests, reviewPixPayment } from "../lib/pix-db.js";

test("Pix inicial inclui implantação, não duplica pendência e só ativa após aprovação", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-pix-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "pix.sqlite");
  try {
    const user = await createUser({ name: "Empresa Pix", email: "pix@teste.local", passwordHash: "hash", accountType: "company" });
    const first = await createOrGetPixPaymentRequest(user.id);
    assert.equal(first.created, true);
    assert.equal(first.payment.kind, "initial");
    assert.equal(first.payment.amountCents, 18000);
    const repeated = await createOrGetPixPaymentRequest(user.id);
    assert.equal(repeated.created, false);
    assert.equal(repeated.payment.id, first.payment.id);
    assert.equal((await getBillingProviderState(user.id)).status, "pending_payment");

    await reviewPixPayment({ id: first.payment.id, approved: true, administratorId: user.id });
    const active = await getBillingProviderState(user.id);
    assert.equal(active.paymentProvider, "pix");
    assert.equal(active.status, "active");
    assert.ok(active.currentPeriodEnd);

    const renewal = await createOrGetPixPaymentRequest(user.id);
    assert.equal(renewal.payment.kind, "renewal");
    assert.equal(renewal.payment.amountCents, 6000);
  } finally {
    await closeDatabaseForTests(); resetPixSchemaForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Pix Copia e Cola contém valor, txid e CRC sem expor segredo bancário", () => {
  const payload = buildPixPayload({ key: "financeiro@example.com", receiverName: "CandTech", receiverCity: "Mairinque", amountCents: 18000, txid: "CT123456" });
  assert.match(payload, /^00020126/);
  assert.match(payload, /5406180\.00/);
  assert.match(payload, /CT123456/);
  assert.match(payload, /6304[A-F0-9]{4}$/);
});
