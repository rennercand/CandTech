import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDatabaseForTests, createOrganizationJob, createUser, deleteHistory, ensureOwnedOrganization,
  findHistoryById, findOrganizationJob, findUserByEmail, findUserById, getWorkspace,
  listOrganizationJobs, saveHistory, saveWorkspace,
} from "../lib/db.js";
import {
  applyInventoryBatch, createInventoryProducts, listInventory, resetInventorySchemaForTests,
} from "../lib/inventory-db.js";

test("entradas com SQL são tratadas como texto e não atravessam contas", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-sql-injection-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "security.sqlite");
  try {
    const owner = await createUser({
      name: "Robert'); DROP TABLE users;--", email: "owner@security.test", passwordHash: "hash", accountType: "company",
    });
    const other = await createUser({ name: "Outra conta", email: "other@security.test", passwordHash: "hash" });

    assert.equal(await findUserByEmail("' OR 1=1 --"), null);
    assert.equal(await findUserById("1 OR 1=1"), null);
    assert.equal((await findUserByEmail("owner@security.test")).name, "Robert'); DROP TABLE users;--");
    assert.equal((await findUserByEmail("other@security.test")).id, other.id);

    const payload = { note: "x'); UPDATE users SET email='attacker@test';--" };
    await saveWorkspace({ userId: owner.id, payload });
    assert.deepEqual((await getWorkspace(owner.id)).payload, payload);
    assert.equal(await getWorkspace(other.id), null);

    const organization = await ensureOwnedOrganization({
      userId: owner.id,
      name: "Loja'); DROP TABLE organizations;--",
    });
    const job = await createOrganizationJob({
      organizationId: organization.organizationId,
      name: "Caixa'); DELETE FROM users;--",
      role: "attendant",
      permissions: ["inventory"],
    });
    assert.equal((await listOrganizationJobs(organization.organizationId))[0].name, "Caixa'); DELETE FROM users;--");
    assert.equal(await findOrganizationJob({ organizationId: "1 OR 1=1", jobId: "1 OR 1=1" }), null);
    assert.equal((await findOrganizationJob({ organizationId: organization.organizationId, jobId: job.id })).id, job.id);

    const privateHistory = await saveHistory({
      userId: owner.id,
      title: "Relatório'); DROP TABLE histories;--",
      calculationType: "teste",
      payload: { value: "' UNION SELECT password_hash FROM users --" },
    });
    assert.equal(await findHistoryById("' OR 1=1 --", other.id), null);
    assert.equal(await deleteHistory("' OR 1=1 --", other.id), false);
    assert.equal((await findHistoryById(privateHistory.item.id, owner.id)).title, "Relatório'); DROP TABLE histories;--");

    const tenantId = `user:${owner.id}`;
    const sku = "SKU'); DROP TABLE inventory_variants;--";
    const created = await createInventoryProducts({ tenantId, products: [{ name: "Produto ' OR 1=1 --", category: "Teste", unit: "un", variants: [{ name: "Padrão", sku, quantity: 0, minimumQuantity: 0, unitCost: 10, salePrice: 20, location: "" }] }] });
    await applyInventoryBatch({
      tenantId,
      userId: owner.id,
      kind: "entry",
      reference: "Entrada'); UPDATE inventory_variants SET quantity=999;--",
      supplier: "Fornecedor' UNION SELECT password_hash FROM users --",
      note: "'); DROP TABLE inventory_movements;--",
      lines: [{
        variantId: created[0].variants[0].id, delta: 2, unitCost: 10, unitPrice: 20,
        lotCode: "LOTE'); DELETE FROM inventory_batches;--", expiresOn: "",
      }],
    });
    const inventory = await listInventory(tenantId);
    assert.equal(inventory.products[0].variants[0].sku, sku);
    assert.equal(inventory.products[0].variants[0].salePrice, 20);
    assert.equal(inventory.products[0].variants[0].quantity, 2);
    assert.equal(inventory.batches[0].reference, "Entrada'); UPDATE inventory_variants SET quantity=999;--");
    assert.equal((await listInventory("user:1' OR 1=1 --")).products.length, 0);
    assert.equal(await findUserByEmail("attacker@test"), null);
    assert.equal((await findUserByEmail("other@security.test")).id, other.id);
  } finally {
    await closeDatabaseForTests();
    await resetInventorySchemaForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
