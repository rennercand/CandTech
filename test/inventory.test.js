import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabaseForTests, createUser } from "../lib/db.js";
import {
  applyInventoryBatch,
  createInventoryOrder,
  createInventoryProducts,
  listInventory,
  resetInventorySchemaForTests,
  undoInventoryBatch,
} from "../lib/inventory-db.js";
import { normalizeMovementLines, validateProducts } from "../lib/inventory.js";
import { parseInventoryText } from "../lib/inventory-import.js";

test("estoque relacional isola empresas, movimenta vários itens e desfaz operações", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-inventory-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "inventory.sqlite");
  try {
    const ownerA = await createUser({ name: "Loja A", email: "a@inventory.test", passwordHash: "hash", accountType: "company" });
    const ownerB = await createUser({ name: "Loja B", email: "b@inventory.test", passwordHash: "hash", accountType: "company" });
    const tenantA = "organization:101";
    const tenantB = "organization:202";
    const source = [{
      name: "Pelúcia", category: "Presentes", unit: "un", variants: [
        { name: "Cachorro", sku: "PEL-CACH", minimumQuantity: 2, unitCost: 10, salePrice: 25 },
        { name: "Gato", sku: "PEL-GATO", minimumQuantity: 2, unitCost: 11, salePrice: 26 },
      ],
    }];
    const checked = validateProducts(source);
    assert.equal(checked.error, undefined);
    const [productA] = await createInventoryProducts({ tenantId: tenantA, products: checked.products });
    await createInventoryProducts({ tenantId: tenantB, products: checked.products });

    const entryLines = normalizeMovementLines(productA.variants.map((variant) => ({ variantId: variant.id, quantity: 10, unitCost: variant.unitCost })));
    const entry = await applyInventoryBatch({ tenantId: tenantA, userId: ownerA.id, kind: "entry", reference: "NF 1", lines: entryLines });
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [10, 10]);
    assert.deepEqual((await listInventory(tenantB)).products[0].variants.map((variant) => variant.quantity), [0, 0]);

    const order = await createInventoryOrder({
      tenantId: tenantA, userId: ownerA.id, type: "sale", reference: "PED-1", partner: "Cliente",
      lines: productA.variants.map((variant) => ({ variantId: variant.id, quantity: 2, delta: 2, unitCost: 0, unitPrice: variant.salePrice, lotCode: "", expiresOn: "" })),
    });
    assert.equal(order.total, 102);
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [8, 8]);
    await undoInventoryBatch({ tenantId: tenantA, userId: ownerA.id, batchPublicId: order.batchId });
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [10, 10]);

    await assert.rejects(() => applyInventoryBatch({
      tenantId: tenantB, userId: ownerB.id, kind: "entry",
      lines: [{ variantId: productA.variants[0].id, quantity: 1, delta: 1, unitCost: 0, lotCode: "", expiresOn: "" }],
    }));
    assert.equal((await listInventory(tenantB)).products[0].variants[0].quantity, 0);

    await undoInventoryBatch({ tenantId: tenantA, userId: ownerA.id, batchPublicId: entry.id });
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [0, 0]);
  } finally {
    await closeDatabaseForTests();
    await resetInventorySchemaForTests();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
    if (previousPath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("importação rejeita SKU repetido e linhas sem quantidade", () => {
  assert.match(validateProducts([
    { name: "A", variants: [{ sku: "MESMO" }] },
    { name: "B", variants: [{ sku: "mesmo" }] },
  ]).error, /repetido/);
  assert.equal(normalizeMovementLines([{ variantId: "abc", quantity: 0 }]), null);
});

test("prévia CSV agrupa variações e preserva lote e validade", () => {
  const preview = parseInventoryText([
    "Produto;Variação;SKU;Quantidade;Custo unitário;Categoria;Lote;Validade",
    "Pelúcia;Cachorro;PEL-1;10;15,50;Presentes;L-1;2027-12-31",
    "Pelúcia;Gato;PEL-2;8;16,00;Presentes;L-2;2027-11-30",
  ].join("\n"));
  assert.equal(preview.products.length, 1);
  assert.equal(preview.variantCount, 2);
  assert.equal(preview.products[0].variants[0].unitCost, 15.5);
  assert.equal(preview.products[0].variants[1].lotCode, "L-2");
  assert.equal(preview.products[0].variants[1].expiresOn, "2027-11-30");
  const excelDate = parseInventoryText("Produto;SKU;Quantidade;Validade\nBolo;BOLO-1;2;46752");
  assert.match(excelDate.products[0].variants[0].expiresOn, /^202\d-\d{2}-\d{2}$/);
});
