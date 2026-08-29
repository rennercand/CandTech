import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { closeDatabaseForTests, createUser, getBillingProviderState, getDatabaseBackend } from "../lib/db.js";
import { reviewPixPaymentManually } from "../lib/manual-payment-review.js";
import { buildPixPayload } from "../lib/pix.js";
import { createOrGetPixPaymentRequest, getLatestPixPayment, resetPixSchemaForTests, reviewPixPayment, savePixPaymentReceipt } from "../lib/pix-db.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

    await savePixPaymentReceipt({
      id: first.payment.id, userId: user.id, storageKey: "local:11111111-1111-4111-8111-111111111111.pdf",
      originalFilename: "comprovante.pdf", contentType: "application/pdf", sizeBytes: 120,
      sha256: "a".repeat(64),
    });
    assert.equal((await getLatestPixPayment(user.id)).status, "payment_review");
    assert.equal((await getBillingProviderState(user.id)).status, "pending_payment", "upload não pode ativar a assinatura");
    await reviewPixPayment({ id: first.payment.id, approved: true, administratorId: user.id });
    const active = await getBillingProviderState(user.id);
    assert.equal(active.paymentProvider, "pix");
    assert.equal(active.status, "active");
    assert.ok(active.currentPeriodEnd);
    assert.ok(active.setupPaidAt);

    const backend = await getDatabaseBackend();
    backend.db.prepare("DELETE FROM pix_payment_requests WHERE user_id=?").run(user.id);

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

test("moderação manual guarda a implantação na conta mesmo sem comprovante", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-pix-setup-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "pix-setup.sqlite");
  try {
    const user = await createUser({ name: "Conta Implantada", email: "implantada@teste.local", passwordHash: "hash" });
    const first = await createOrGetPixPaymentRequest(user.id);
    assert.equal(first.payment.amountCents, 18000);

    await reviewPixPaymentManually({ id: first.payment.id, approved: true, administratorId: user.id });
    assert.ok((await getBillingProviderState(user.id)).setupPaidAt);

    const backend = await getDatabaseBackend();
    backend.db.prepare("DELETE FROM pix_payment_requests WHERE user_id=?").run(user.id);
    backend.db.prepare("UPDATE billing_profiles SET subscription_status='past_due', subscription_current_period_end=NULL WHERE user_id=?").run(user.id);

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

test("QR Code Pix é gerado localmente a partir do mesmo Copia e Cola", async () => {
  const payload = buildPixPayload({ key: "financeiro@example.com", receiverName: "CandTech", receiverCity: "Mairinque", amountCents: 18000, txid: "CT123456" });
  const dataUrl = await QRCode.toDataURL(payload, { width: 280 });
  const page = readFileSync(join(projectRoot, "app", "assinar", "page.js"), "utf8");

  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.match(page, /QRCode\.toDataURL\(payment\.pixCode/);
  assert.doesNotMatch(page, /api\.qrserver|chart\.googleapis|quickchart/);
});
