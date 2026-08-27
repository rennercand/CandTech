import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser, getBillingProviderState, getDatabaseBackend } from "../lib/db.js";
import {
  createOrGetPixPaymentRequest, getActivePixReceiptForAdmin, getOwnedPixPaymentForReceipt,
  resetPixSchemaForTests, savePixPaymentReceipt,
} from "../lib/pix-db.js";
import { PIX_RECEIPT_MAX_BYTES, PixReceiptValidationError, validatePixReceipt } from "../lib/pix-receipt.js";

const pdf = new TextEncoder().encode("%PDF-1.7\ncomprovante");

test("validação aceita os quatro formatos permitidos e confere magic bytes", () => {
  const samples = [
    ["pix.pdf", "application/pdf", pdf],
    ["pix.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00])],
    ["pix.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["pix.webp", "image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
  ];
  for (const [filename, contentType, bytes] of samples) assert.equal(validatePixReceipt({ filename, contentType, bytes }).contentType, contentType);
});

test("upload rejeita tamanho, MIME falso e tentativa de path traversal", () => {
  assert.throws(() => validatePixReceipt({ filename: "../../pix.pdf", contentType: "application/pdf", bytes: pdf }), PixReceiptValidationError);
  assert.throws(() => validatePixReceipt({ filename: "pix.pdf", contentType: "image/png", bytes: pdf }), PixReceiptValidationError);
  assert.throws(() => validatePixReceipt({ filename: "pix.svg", contentType: "image/svg+xml", bytes: pdf }), PixReceiptValidationError);
  assert.throws(() => validatePixReceipt({ filename: "pix.pdf", contentType: "application/pdf", bytes: new Uint8Array(PIX_RECEIPT_MAX_BYTES + 1) }), /5 MB/);
});

test("comprovante respeita proprietário, não ativa assinatura e mantém um único arquivo ativo", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-pix-receipt-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "receipt.sqlite");
  try {
    const owner = await createUser({ name: "Titular", email: "owner@receipt.test", passwordHash: "hash", accountType: "company" });
    const outsider = await createUser({ name: "Outra pessoa", email: "other@receipt.test", passwordHash: "hash" });
    const request = await createOrGetPixPaymentRequest(owner.id);
    assert.equal(await getOwnedPixPaymentForReceipt({ id: request.payment.id, userId: outsider.id }), null);

    const first = await savePixPaymentReceipt({
      id: request.payment.id, userId: owner.id, storageKey: "local:33333333-3333-4333-8333-333333333333.pdf",
      originalFilename: "primeiro.pdf", contentType: "application/pdf", sizeBytes: pdf.length, sha256: "c".repeat(64),
    });
    assert.equal(first.duplicate, false);
    assert.equal((await getBillingProviderState(owner.id)).status, "pending_payment");

    const replacement = await savePixPaymentReceipt({
      id: request.payment.id, userId: owner.id, storageKey: "local:44444444-4444-4444-8444-444444444444.pdf",
      originalFilename: "segundo.pdf", contentType: "application/pdf", sizeBytes: pdf.length, sha256: "d".repeat(64),
    });
    assert.equal(replacement.replacedStorageKey, "local:33333333-3333-4333-8333-333333333333.pdf");
    assert.equal((await getActivePixReceiptForAdmin(request.payment.id)).originalFilename, "segundo.pdf");

    const duplicate = await savePixPaymentReceipt({
      id: request.payment.id, userId: owner.id, storageKey: "local:55555555-5555-4555-8555-555555555555.pdf",
      originalFilename: "segundo.pdf", contentType: "application/pdf", sizeBytes: pdf.length, sha256: "d".repeat(64),
    });
    assert.equal(duplicate.duplicate, true);

    const expiredOwner = await createUser({ name: "Expirado", email: "expired@receipt.test", passwordHash: "hash" });
    const expired = await createOrGetPixPaymentRequest(expiredOwner.id);
    const backend = await getDatabaseBackend();
    backend.db.prepare("UPDATE pix_payment_requests SET due_at=? WHERE public_id=?").run("2020-01-01T00:00:00.000Z", expired.payment.id);
    assert.equal(await savePixPaymentReceipt({
      id: expired.payment.id, userId: expiredOwner.id, storageKey: "local:66666666-6666-4666-8666-666666666666.pdf",
      originalFilename: "expirado.pdf", contentType: "application/pdf", sizeBytes: pdf.length, sha256: "e".repeat(64),
    }), null);
  } finally {
    await closeDatabaseForTests(); resetPixSchemaForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rotas de comprovante exigem sessão do titular e administrador", () => {
  const upload = readFileSync(new URL("../app/api/pix/[paymentId]/receipt/route.js", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../app/api/admin/payments/[paymentId]/receipt/route.js", import.meta.url), "utf8");
  const subscribe = readFileSync(new URL("../app/assinar/page.js", import.meta.url), "utf8");
  assert.match(upload, /getSession\(request, \{ allowInactiveSubscription: true \}\)/);
  assert.match(upload, /getOwnedPixPaymentForReceipt\(\{ id: paymentId, userId: user\.id \}\)/);
  assert.match(subscribe, /access: "private"/);
  assert.match(upload, /maximumSizeInBytes: PIX_RECEIPT_MAX_BYTES/);
  assert.match(upload, /blob\.generate-client-token/);
  assert.match(upload, /validatePixReceipt/);
  assert.match(upload, /payment\.receiptStorageKey === storageKey/);
  assert.match(admin, /getAdministratorAccess\(user\)/);
  assert.match(admin, /access\.canBilling/);
  assert.match(admin, /Cache-Control": "private, no-store/);
  assert.match(admin, /publicIdPattern\.test/);
});
