import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabaseForTests, createUser, ensureOwnedOrganization } from "../lib/db.js";
import { createInventoryOrder, createInventoryProducts, resetInventorySchemaForTests } from "../lib/inventory-db.js";
import { listSuppliers, saveSupplier } from "../lib/supplier-db.js";

test("fornecedores são relacionais, isolados por empresa e acumulam compras", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-suppliers-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "suppliers.sqlite");
  try {
    const ownerA = await createUser({ name: "Comprador A", email: "buyer-a@test.local", passwordHash: "hash" });
    const ownerB = await createUser({ name: "Comprador B", email: "buyer-b@test.local", passwordHash: "hash" });
    const organizationA = await ensureOwnedOrganization({ userId: ownerA.id, name: "Comprador A" });
    const organizationB = await ensureOwnedOrganization({ userId: ownerB.id, name: "Comprador B" });
    const tenantA = `organization:${organizationA.organizationId}`;
    const tenantB = `organization:${organizationB.organizationId}`;
    const supplierA = await saveSupplier({ tenantId: tenantA, data: {
      name: "Distribuidora A", document: "123", contactName: "Ana", email: "ana@example.com", phone: "11999999999", leadTimeDays: 5,
    } });
    const supplierB = await saveSupplier({ tenantId: tenantB, data: {
      name: "Distribuidora B", document: "", contactName: "", email: "", phone: "", leadTimeDays: 2,
    } });
    const [product] = await createInventoryProducts({ tenantId: tenantA, products: [{
      name: "Cabo", category: "Acessórios", unit: "un", variants: [{ name: "Padrão", sku: "CABO-1", quantity: 0,
        minimumQuantity: 1, unitCost: 10, salePrice: 20, location: "", lotCode: "", expiresOn: "" }],
    }] });
    const line = { variantId: product.variants[0].id, quantity: 4, unitCost: 10, unitPrice: 10, lotCode: "", expiresOn: "" };
    const purchase = await createInventoryOrder({ tenantId: tenantA, userId: ownerA.id, type: "purchase", reference: "NF-10",
      partner: "texto substituído", supplierId: supplierA.id, lines: [line], paymentMethod: "pending", dueOn: "2026-09-10", idempotencyKeyHash: "supplier-order-a" });
    assert.equal(purchase.total, 40);
    assert.deepEqual((await listSuppliers(tenantA)).map(({ name, purchaseCount, totalPurchased, leadTimeDays }) => ({ name, purchaseCount, totalPurchased, leadTimeDays })), [
      { name: "Distribuidora A", purchaseCount: 1, totalPurchased: 40, leadTimeDays: 5 },
    ]);
    assert.deepEqual((await listSuppliers(tenantB)).map((supplier) => supplier.name), ["Distribuidora B"]);
    await assert.rejects(() => createInventoryOrder({ tenantId: tenantA, userId: ownerA.id, type: "purchase", reference: "INVÁLIDA",
      partner: "", supplierId: supplierB.id, lines: [line], paymentMethod: "cash", idempotencyKeyHash: "supplier-order-cross" }), /INVALID_SUPPLIER/);
  } finally {
    await closeDatabaseForTests();
    await resetInventorySchemaForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
