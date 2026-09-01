import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabaseForTests, createUser, ensureOwnedOrganization, getDatabaseBackend } from "../lib/db.js";
import {
  applyInventoryBatch,
  createInventoryOrder,
  createInventoryProducts,
  listInventory,
  resetInventorySchemaForTests,
  undoInventoryBatch,
} from "../lib/inventory-db.js";
import { normalizeMovementLines, validateProducts } from "../lib/inventory.js";
import { matchInventoryEntry, parseInventoryRows, parseInventoryText } from "../lib/inventory-import.js";
import { canExportInventory, inventoryCsv, inventoryXlsx } from "../lib/inventory-report.js";
import { strFromU8, unzipSync } from "fflate";

test("estoque relacional isola empresas, movimenta vários itens e desfaz operações", async () => {
  const directory = mkdtempSync(join(tmpdir(), "candtech-inventory-"));
  const previousEnvironment = process.env.NODE_ENV;
  const previousPath = process.env.SQLITE_DATABASE_PATH;
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "inventory.sqlite");
  try {
    const ownerA = await createUser({ name: "Loja A", email: "a@inventory.test", passwordHash: "hash", accountType: "company" });
    const ownerB = await createUser({ name: "Loja B", email: "b@inventory.test", passwordHash: "hash", accountType: "company" });
    const organizationA = await ensureOwnedOrganization({ userId: ownerA.id, name: "Loja A" });
    const organizationB = await ensureOwnedOrganization({ userId: ownerB.id, name: "Loja B" });
    const tenantA = `organization:${organizationA.organizationId}`;
    const tenantB = `organization:${organizationB.organizationId}`;
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
      idempotencyKeyHash: "order-key-1",
      lines: productA.variants.map((variant) => ({ variantId: variant.id, quantity: 2, delta: 2, unitCost: 0, unitPrice: variant.salePrice, lotCode: "", expiresOn: "" })),
    });
    assert.equal(order.total, 102);
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [8, 8]);
    const replayedOrder = await createInventoryOrder({
      tenantId: tenantA, userId: ownerA.id, type: "sale", reference: "PED-1", partner: "Cliente",
      idempotencyKeyHash: "order-key-1",
      lines: productA.variants.map((variant) => ({ variantId: variant.id, quantity: 2, delta: 2, unitCost: 0, unitPrice: variant.salePrice, lotCode: "", expiresOn: "" })),
    });
    assert.equal(replayedOrder.id, order.id);
    assert.equal(replayedOrder.replayed, true);
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [8, 8]);
    const backendAfterOrder = await getDatabaseBackend();
    assert.equal(backendAfterOrder.db.prepare("SELECT COUNT(*) AS count FROM inventory_orders WHERE tenant_id = ?").get(tenantA).count, 1);
    assert.equal(backendAfterOrder.db.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ?").get(order.id).count, 1);
    await assert.rejects(() => createInventoryOrder({
      tenantId: tenantA, userId: ownerA.id, type: "sale", reference: "PED-SEM-SALDO", partner: "Cliente",
      idempotencyKeyHash: "order-key-insufficient",
      lines: [{ variantId: productA.variants[0].id, quantity: 999, unitCost: 0, unitPrice: 25, lotCode: "", expiresOn: "" }],
    }));
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [8, 8]);
    assert.equal(backendAfterOrder.db.prepare("SELECT COUNT(*) AS count FROM inventory_orders WHERE tenant_id = ?").get(tenantA).count, 1);
    assert.equal(backendAfterOrder.db.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_type = 'inventory_order'").get().count, 1);
    await undoInventoryBatch({ tenantId: tenantA, userId: ownerA.id, batchPublicId: order.batchId });
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [10, 10]);

    await assert.rejects(() => applyInventoryBatch({
      tenantId: tenantB, userId: ownerB.id, kind: "entry",
      lines: [{ variantId: productA.variants[0].id, quantity: 1, delta: 1, unitCost: 0, lotCode: "", expiresOn: "" }],
    }));
    assert.equal((await listInventory(tenantB)).products[0].variants[0].quantity, 0);

    await undoInventoryBatch({ tenantId: tenantA, userId: ownerA.id, batchPublicId: entry.id });
    assert.deepEqual((await listInventory(tenantA)).products[0].variants.map((variant) => variant.quantity), [0, 0]);

    const backend = await getDatabaseBackend();
    const scopes = backend.db.prepare(`
      SELECT tenant_id, organization_id FROM inventory_products
      UNION ALL SELECT tenant_id, organization_id FROM inventory_variants
      UNION ALL SELECT tenant_id, organization_id FROM inventory_batches
      UNION ALL SELECT tenant_id, organization_id FROM inventory_movements
      UNION ALL SELECT tenant_id, organization_id FROM inventory_orders
    `).all();
    assert.ok(scopes.length > 0);
    for (const scope of scopes) {
      assert.equal(scope.organization_id, Number(scope.tenant_id.replace("organization:", "")));
    }
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

test("catálogo comercial encontra cabeçalho abaixo do título e aceita saldo inicial zero", () => {
  const csv = parseInventoryText([
    "Cadastro de Bichos e Pelúcias;;;",
    ";;;",
    "SKU;Nome;Valor;Fornecedor",
    "PEL-001;Urso de Pelúcia Marrom;R$ 59,90;Mundo Fofo",
    "PEL-002;Coelho de Pelúcia Branco;R$ 1.249,50;Encanto Brinquedos",
  ].join("\n"));
  assert.equal(csv.products.length, 2);
  assert.equal(csv.products[0].variants[0].quantity, 0);
  assert.equal(csv.products[0].variants[0].salePrice, 59.9);
  assert.equal(csv.products[1].variants[0].salePrice, 1249.5);
  assert.equal(csv.hasQuantityColumn, false);
  assert.match(csv.warnings.join(" "), /linha 3/i);
  assert.match(csv.warnings.join(" "), /Fornecedor/);

  const xlsxRows = parseInventoryRows([
    ["Cadastro de Bichos e Pelúcias", "", "", ""],
    ["", "", "", ""],
    ["SKU", "Nome", "Valor", "Fornecedor"],
    ["PEL-001", "Urso de Pelúcia Marrom", "59.9", "Mundo Fofo"],
  ]);
  assert.equal(xlsxRows.variantCount, 1);
  assert.equal(xlsxRows.products[0].variants[0].salePrice, 59.9);
  const entry = matchInventoryEntry(xlsxRows, [{ id: "variant-1", sku: "PEL-001" }]);
  assert.match(entry.errors.join(" "), /coluna Quantidade/);
});

test("entrada por planilha associa somente SKUs existentes e exige quantidade recebida", () => {
  const preview = parseInventoryText([
    "Produto;SKU;Quantidade;Custo unitário;Lote;Validade",
    "Pelúcia;PEL-1;3;16,50;L-3;2027-10-30",
    "Pelúcia;DESCONHECIDO;2;10,00;;",
  ].join("\n"));
  const matched = matchInventoryEntry(preview, [{ id: "variant-1", sku: "PEL-1", unitCost: 15 }]);
  assert.equal(matched.lines.length, 1);
  assert.deepEqual(matched.lines[0], {
    variantId: "variant-1", quantity: 3, unitCost: 16.5, lotCode: "L-3", expiresOn: "2027-10-30",
  });
  assert.match(matched.errors.join(" "), /DESCONHECIDO/);

  const zero = matchInventoryEntry(parseInventoryText("Produto;SKU;Quantidade\nPelúcia;PEL-1;0"), [{ id: "variant-1", sku: "PEL-1" }]);
  assert.match(zero.errors.join(" "), /maior que zero/);
});

test("relatórios do estoque são reimportáveis, seguros e incluem lotes no Excel", () => {
  const inventory = {
    products: [{ name: "=Produto perigoso", category: "Presentes", unit: "un", variants: [{
      name: "Padrão", sku: "+SKU-1", quantity: 7, minimumQuantity: 2, unitCost: 12.5,
      salePrice: 25, location: "Prateleira A",
    }] }],
    orders: [],
    lots: [{ product_name: "Produto", variant_name: "Padrão", sku: "SKU-1", lot_code: "L-1", expires_on: "2027-12-31", received_quantity: 7 }],
  };
  const csv = inventoryCsv(inventory);
  assert.match(csv, /"Produto";.*"SKU";"Quantidade"/);
  assert.match(csv, /"'=Produto perigoso"/);
  assert.match(csv, /"'\+SKU-1"/);
  const roundTrip = parseInventoryText(csv);
  assert.equal(roundTrip.products[0].variants[0].quantity, 7);

  const files = unzipSync(new Uint8Array(inventoryXlsx(inventory)));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /Lotes e validades recebidos/);
  assert.match(sheet, /L-1/);
  assert.match(sheet, /PreÃ§o de venda|Preço de venda/);
});

test("relatório de estoque exige leitura, exportação e permissão adicional para Drive", () => {
  const access = (permissions) => ({ role: "attendant", permissions });
  assert.equal(canExportInventory(access(["inventory"])), false);
  assert.equal(canExportInventory(access(["inventory", "exports"])), true);
  assert.equal(canExportInventory(access(["commerce", "exports"])), true);
  assert.equal(canExportInventory(access(["inventory", "exports"]), { drive: true }), false);
  assert.equal(canExportInventory(access(["inventory", "exports", "drive"]), { drive: true }), true);
  assert.equal(canExportInventory({ role: "owner", permissions: [] }, { drive: true }), true);
});
