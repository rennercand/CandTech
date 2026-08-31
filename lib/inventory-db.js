import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";

let schemaPromise;

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const backend = await getDatabaseBackend();
    // No Neon, as migrations relacionais e de escopo organizacional do estoque
    // são aplicadas antes do deploy. Apenas o SQLite local prepara o schema.
    if (backend.type === "sqlite") {
      backend.db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_products (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, organization_id INTEGER,
          name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT 'un', active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_inventory_products_tenant ON inventory_products(tenant_id, active, name);
        CREATE TABLE IF NOT EXISTS inventory_variants (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, organization_id INTEGER,
          product_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT 'Padrão', sku TEXT NOT NULL,
          quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0), minimum_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_quantity >= 0),
          unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0), sale_price REAL NOT NULL DEFAULT 0 CHECK(sale_price >= 0),
          location TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, sku),
          FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE CASCADE,
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_inventory_variants_product ON inventory_variants(tenant_id, product_id, active);
        CREATE TABLE IF NOT EXISTS inventory_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, organization_id INTEGER, kind TEXT NOT NULL,
          reference TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
          actor_user_id INTEGER NOT NULL, reversed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(actor_user_id) REFERENCES users(id), FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_inventory_batches_tenant ON inventory_batches(tenant_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS inventory_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, organization_id INTEGER,
          batch_id INTEGER NOT NULL, variant_id INTEGER NOT NULL, kind TEXT NOT NULL, quantity_delta REAL NOT NULL CHECK(quantity_delta <> 0),
          unit_cost REAL NOT NULL DEFAULT 0, lot_code TEXT NOT NULL DEFAULT '', expires_on TEXT, reason TEXT NOT NULL DEFAULT '',
          reversed_from_id INTEGER, actor_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(batch_id) REFERENCES inventory_batches(id), FOREIGN KEY(variant_id) REFERENCES inventory_variants(id),
          FOREIGN KEY(reversed_from_id) REFERENCES inventory_movements(id), FOREIGN KEY(actor_user_id) REFERENCES users(id),
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_variant ON inventory_movements(tenant_id, variant_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS inventory_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, organization_id INTEGER, type TEXT NOT NULL,
          reference TEXT NOT NULL DEFAULT '', partner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'completed', total REAL NOT NULL DEFAULT 0,
          batch_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(batch_id) REFERENCES inventory_batches(id), FOREIGN KEY(actor_user_id) REFERENCES users(id),
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_inventory_orders_tenant ON inventory_orders(tenant_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS inventory_order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, variant_id INTEGER NOT NULL,
          quantity REAL NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL DEFAULT 0,
          FOREIGN KEY(order_id) REFERENCES inventory_orders(id) ON DELETE CASCADE, FOREIGN KEY(variant_id) REFERENCES inventory_variants(id));
      `);
      for (const table of ["inventory_products", "inventory_variants", "inventory_batches", "inventory_movements", "inventory_orders"]) {
        const columns = backend.db.prepare(`PRAGMA table_info(${table})`).all();
        if (!columns.some((column) => column.name === "organization_id")) {
          backend.db.exec(`ALTER TABLE ${table} ADD COLUMN organization_id INTEGER`);
        }
      }
      backend.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_inventory_products_organization ON inventory_products(organization_id, active, name);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_variants_organization_sku ON inventory_variants(organization_id, sku) WHERE organization_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_inventory_variants_organization_product ON inventory_variants(organization_id, product_id, active);
        CREATE INDEX IF NOT EXISTS idx_inventory_batches_organization_created ON inventory_batches(organization_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_movements_organization_variant ON inventory_movements(organization_id, variant_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_created ON inventory_orders(organization_id, created_at DESC);
      `);
    }
    return backend;
  })();
  return schemaPromise;
}

function sqliteOrganizationId(db, tenantId) {
  return db.prepare("SELECT id FROM organizations WHERE ? = 'organization:' || CAST(id AS TEXT)").get(tenantId)?.id || null;
}

function serializeVariant(row) {
  return {
    id: row.variant_public_id || row.public_id,
    name: row.variant_name || row.name,
    sku: row.sku,
    quantity: Number(row.quantity),
    minimumQuantity: Number(row.minimum_quantity),
    unitCost: Number(row.unit_cost),
    salePrice: Number(row.sale_price),
    location: row.location || "",
  };
}

export async function listInventory(tenantId) {
  const backend = await ensureSchema();
  let rows; let batches; let orders; let lots;
  if (backend.type === "postgres") {
    [rows, batches, orders, lots] = await Promise.all([
      backend.sql`SELECT p.public_id AS product_public_id, p.name AS product_name, p.category, p.unit,
        v.public_id AS variant_public_id, v.name AS variant_name, v.sku, v.quantity, v.minimum_quantity,
        v.unit_cost, v.sale_price, v.location
        FROM inventory_products p JOIN inventory_variants v ON v.product_id = p.id
        WHERE p.tenant_id = ${tenantId}
          AND p.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
          AND p.active = TRUE AND v.tenant_id = ${tenantId}
          AND v.organization_id IS NOT DISTINCT FROM p.organization_id AND v.active = TRUE
        ORDER BY p.name, v.name`,
      backend.sql`SELECT b.public_id AS id, b.kind, b.reference, b.supplier, b.note, b.status, b.created_at,
        COUNT(m.id)::int AS item_count, COALESCE(SUM(ABS(m.quantity_delta)), 0) AS total_units
        FROM inventory_batches b LEFT JOIN inventory_movements m ON m.batch_id = b.id AND m.reversed_from_id IS NULL
        WHERE b.tenant_id = ${tenantId}
          AND b.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
        GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20`,
      backend.sql`SELECT public_id AS id, type, reference, partner, status, total, created_at
        FROM inventory_orders WHERE tenant_id = ${tenantId}
          AND organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
        ORDER BY created_at DESC LIMIT 20`,
      backend.sql`SELECT m.lot_code, m.expires_on, v.public_id AS variant_id, p.name AS product_name,
        v.name AS variant_name, v.sku, SUM(m.quantity_delta) AS received_quantity
        FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
        JOIN inventory_variants v ON v.id = m.variant_id JOIN inventory_products p ON p.id = v.product_id
        WHERE m.tenant_id = ${tenantId}
          AND m.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
          AND b.organization_id IS NOT DISTINCT FROM m.organization_id
          AND v.organization_id IS NOT DISTINCT FROM m.organization_id
          AND b.status = 'active' AND m.quantity_delta > 0
          AND (m.lot_code <> '' OR m.expires_on IS NOT NULL)
        GROUP BY m.lot_code, m.expires_on, v.public_id, p.name, v.name, v.sku
        ORDER BY m.expires_on NULLS LAST, p.name LIMIT 100`,
    ]);
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    rows = backend.db.prepare(`SELECT p.public_id AS product_public_id, p.name AS product_name, p.category, p.unit,
      v.public_id AS variant_public_id, v.name AS variant_name, v.sku, v.quantity, v.minimum_quantity,
      v.unit_cost, v.sale_price, v.location FROM inventory_products p JOIN inventory_variants v ON v.product_id = p.id
      WHERE p.tenant_id = ? AND p.organization_id IS ? AND p.active = 1
        AND v.tenant_id = ? AND v.organization_id IS p.organization_id AND v.active = 1
      ORDER BY p.name, v.name`).all(tenantId, organizationId, tenantId);
    batches = backend.db.prepare(`SELECT b.public_id AS id, b.kind, b.reference, b.supplier, b.note, b.status, b.created_at,
      COUNT(m.id) AS item_count, COALESCE(SUM(ABS(m.quantity_delta)), 0) AS total_units
      FROM inventory_batches b LEFT JOIN inventory_movements m ON m.batch_id = b.id AND m.reversed_from_id IS NULL
      WHERE b.tenant_id = ? AND b.organization_id IS ?
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20`).all(tenantId, organizationId);
    orders = backend.db.prepare(`SELECT public_id AS id, type, reference, partner, status, total, created_at
      FROM inventory_orders WHERE tenant_id = ? AND organization_id IS ? ORDER BY created_at DESC LIMIT 20`).all(tenantId, organizationId);
    lots = backend.db.prepare(`SELECT m.lot_code, m.expires_on, v.public_id AS variant_id, p.name AS product_name,
      v.name AS variant_name, v.sku, SUM(m.quantity_delta) AS received_quantity
      FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
      JOIN inventory_variants v ON v.id = m.variant_id JOIN inventory_products p ON p.id = v.product_id
      WHERE m.tenant_id = ? AND m.organization_id IS ?
        AND b.organization_id IS m.organization_id AND v.organization_id IS m.organization_id
        AND b.status = 'active' AND m.quantity_delta > 0 AND (m.lot_code <> '' OR m.expires_on IS NOT NULL)
      GROUP BY m.lot_code, m.expires_on, v.public_id, p.name, v.name, v.sku
      ORDER BY CASE WHEN m.expires_on IS NULL THEN 1 ELSE 0 END, m.expires_on, p.name LIMIT 100`).all(tenantId, organizationId);
  }
  const products = [];
  const byId = new Map();
  for (const row of rows) {
    let product = byId.get(row.product_public_id);
    if (!product) {
      product = { id: row.product_public_id, name: row.product_name, category: row.category, unit: row.unit, variants: [] };
      byId.set(row.product_public_id, product); products.push(product);
    }
    product.variants.push(serializeVariant(row));
  }
  return {
    products,
    batches: batches.map((row) => ({ ...row, item_count: Number(row.item_count), total_units: Number(row.total_units) })),
    orders: orders.map((row) => ({ ...row, total: Number(row.total) })),
    lots: lots.map((row) => ({ ...row, received_quantity: Number(row.received_quantity) })),
  };
}

export async function createInventoryProducts({ tenantId, products }) {
  const backend = await ensureSchema();
  const created = products.map((product) => ({
    ...product, id: randomUUID(), variants: product.variants.map((variant) => ({ ...variant, id: randomUUID() })),
  }));
  if (backend.type === "postgres") {
    await backend.sql.transaction((tx) => created.flatMap((product) => [
      tx`INSERT INTO inventory_products (public_id, tenant_id, organization_id, name, category, unit)
        VALUES (${product.id}, ${tenantId}, (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text), ${product.name}, ${product.category}, ${product.unit})`,
      ...product.variants.map((variant) => tx`INSERT INTO inventory_variants
        (public_id, tenant_id, organization_id, product_id, name, sku, minimum_quantity, unit_cost, sale_price, location)
        SELECT ${variant.id}, ${tenantId}, organization_id, id, ${variant.name}, ${variant.sku}, ${variant.minimumQuantity},
          ${variant.unitCost}, ${variant.salePrice}, ${variant.location}
        FROM inventory_products WHERE public_id = ${product.id} AND tenant_id = ${tenantId}`),
    ]), { isolationLevel: "Serializable" });
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    backend.db.exec("BEGIN IMMEDIATE");
    try {
      const insertProduct = backend.db.prepare("INSERT INTO inventory_products (public_id, tenant_id, organization_id, name, category, unit) VALUES (?, ?, ?, ?, ?, ?)");
      const insertVariant = backend.db.prepare(`INSERT INTO inventory_variants
        (public_id, tenant_id, organization_id, product_id, name, sku, minimum_quantity, unit_cost, sale_price, location)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const product of created) {
        const result = insertProduct.run(product.id, tenantId, organizationId, product.name, product.category, product.unit);
        for (const variant of product.variants) insertVariant.run(variant.id, tenantId, organizationId, Number(result.lastInsertRowid), variant.name,
          variant.sku, variant.minimumQuantity, variant.unitCost, variant.salePrice, variant.location);
      }
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return created;
}

function combineLines(lines) {
  const combined = new Map();
  for (const line of lines) {
    const current = combined.get(line.variantId);
    combined.set(line.variantId, current ? { ...current, delta: current.delta + line.delta, quantity: current.quantity + line.quantity } : { ...line });
  }
  return [...combined.values()];
}

export async function applyInventoryBatch({ tenantId, userId, kind, reference = "", supplier = "", note = "", lines }) {
  const backend = await ensureSchema();
  const safeLines = combineLines(lines);
  const batchId = randomUUID();
  if (backend.type === "postgres") {
    await backend.sql.transaction((tx) => [
      tx`INSERT INTO inventory_batches (public_id, tenant_id, organization_id, kind, reference, supplier, note, actor_user_id)
        VALUES (${batchId}, ${tenantId}, (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text), ${kind}, ${reference}, ${supplier}, ${note}, ${userId})`,
      ...safeLines.map((line) => {
        const movementId = randomUUID();
        return tx`WITH changed AS (
          UPDATE inventory_variants SET quantity = quantity + ${line.delta},
            unit_cost = CASE WHEN ${line.delta} > 0 AND ${line.unitCost} > 0 THEN ${line.unitCost} ELSE unit_cost END,
            updated_at = NOW()
          WHERE tenant_id = ${tenantId} AND public_id = ${line.variantId} AND quantity + ${line.delta} >= 0
          RETURNING id
        ) INSERT INTO inventory_movements
          (public_id, tenant_id, organization_id, batch_id, variant_id, kind, quantity_delta, unit_cost, lot_code, expires_on, reason, actor_user_id)
          SELECT ${movementId}, ${tenantId}, b.organization_id, b.id, changed.id, ${kind}, ${line.delta}, ${line.unitCost},
            ${line.lotCode}, ${line.expiresOn || null}, ${note}, ${userId}
          FROM changed CROSS JOIN inventory_batches b WHERE b.public_id = ${batchId} AND b.tenant_id = ${tenantId}`;
      }),
      tx`SELECT 1 / CASE WHEN COUNT(*) = ${safeLines.length} THEN 1 ELSE COUNT(*) - COUNT(*) END AS valid
        FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
        WHERE b.public_id = ${batchId} AND b.tenant_id = ${tenantId}`,
    ], { isolationLevel: "Serializable" });
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    backend.db.exec("BEGIN IMMEDIATE");
    try {
      const batch = backend.db.prepare(`INSERT INTO inventory_batches
        (public_id, tenant_id, organization_id, kind, reference, supplier, note, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(batchId, tenantId, organizationId, kind, reference, supplier, note, userId);
      const update = backend.db.prepare(`UPDATE inventory_variants SET quantity = quantity + ?,
        unit_cost = CASE WHEN ? > 0 AND ? > 0 THEN ? ELSE unit_cost END, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND public_id = ? AND quantity + ? >= 0`);
      const insert = backend.db.prepare(`INSERT INTO inventory_movements
        (public_id, tenant_id, organization_id, batch_id, variant_id, kind, quantity_delta, unit_cost, lot_code, expires_on, reason, actor_user_id)
        SELECT ?, ?, ?, ?, id, ?, ?, ?, ?, ?, ?, ? FROM inventory_variants WHERE tenant_id = ? AND public_id = ?`);
      for (const line of safeLines) {
        const changed = update.run(line.delta, line.delta, line.unitCost, line.unitCost, tenantId, line.variantId, line.delta);
        if (changed.changes !== 1) throw new Error("INSUFFICIENT_STOCK_OR_UNKNOWN_VARIANT");
        insert.run(randomUUID(), tenantId, organizationId, Number(batch.lastInsertRowid), kind, line.delta, line.unitCost, line.lotCode,
          line.expiresOn || null, note, userId, tenantId, line.variantId);
      }
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return { id: batchId };
}

export async function undoInventoryBatch({ tenantId, userId, batchPublicId }) {
  const backend = await ensureSchema();
  const reversalId = randomUUID();
  if (backend.type === "postgres") {
    const movements = await backend.sql`SELECT m.id, m.variant_id, m.quantity_delta, m.unit_cost, m.lot_code, m.expires_on
      FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
      WHERE b.public_id = ${batchPublicId} AND b.tenant_id = ${tenantId} AND b.status = 'active' AND m.reversed_from_id IS NULL`;
    if (!movements.length) return null;
    await backend.sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${batchPublicId}`}))`,
      tx`INSERT INTO inventory_batches (public_id, tenant_id, organization_id, kind, reference, note, actor_user_id)
        VALUES (${reversalId}, ${tenantId}, (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text), 'reversal', ${batchPublicId}, 'Desfazimento de operação', ${userId})`,
      ...movements.map((movement) => tx`WITH changed AS (
        UPDATE inventory_variants SET quantity = quantity - ${movement.quantity_delta}, updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND id = ${movement.variant_id} AND quantity - ${movement.quantity_delta} >= 0
          AND EXISTS (SELECT 1 FROM inventory_batches original
            WHERE original.public_id = ${batchPublicId} AND original.tenant_id = ${tenantId} AND original.status = 'active')
        RETURNING id
      ) INSERT INTO inventory_movements
        (public_id, tenant_id, organization_id, batch_id, variant_id, kind, quantity_delta, unit_cost, lot_code, expires_on, reason, reversed_from_id, actor_user_id)
        SELECT ${randomUUID()}, ${tenantId}, b.organization_id, b.id, changed.id, 'reversal', ${-Number(movement.quantity_delta)},
          ${Number(movement.unit_cost)}, ${movement.lot_code}, ${movement.expires_on}, 'Desfazimento de operação', ${movement.id}, ${userId}
        FROM changed CROSS JOIN inventory_batches b WHERE b.public_id = ${reversalId}`),
      tx`SELECT 1 / CASE WHEN COUNT(*) = ${movements.length} THEN 1 ELSE COUNT(*) - COUNT(*) END FROM inventory_movements m
        JOIN inventory_batches b ON b.id = m.batch_id WHERE b.public_id = ${reversalId}`,
      tx`UPDATE inventory_batches SET status = 'reversed', reversed_at = NOW()
        WHERE public_id = ${batchPublicId} AND tenant_id = ${tenantId} AND status = 'active'`,
    ], { isolationLevel: "Serializable" });
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    backend.db.exec("BEGIN IMMEDIATE");
    try {
      const original = backend.db.prepare("SELECT id FROM inventory_batches WHERE public_id = ? AND tenant_id = ? AND status = 'active'").get(batchPublicId, tenantId);
      if (!original) { backend.db.exec("ROLLBACK"); return null; }
      const movements = backend.db.prepare("SELECT * FROM inventory_movements WHERE batch_id = ? AND reversed_from_id IS NULL").all(original.id);
      const reversal = backend.db.prepare(`INSERT INTO inventory_batches
        (public_id, tenant_id, organization_id, kind, reference, note, actor_user_id) VALUES (?, ?, ?, 'reversal', ?, 'Desfazimento de operação', ?)`)
        .run(reversalId, tenantId, organizationId, batchPublicId, userId);
      for (const movement of movements) {
        const changed = backend.db.prepare(`UPDATE inventory_variants SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND id = ? AND quantity - ? >= 0`).run(movement.quantity_delta, tenantId, movement.variant_id, movement.quantity_delta);
        if (changed.changes !== 1) throw new Error("UNDO_WOULD_CREATE_NEGATIVE_STOCK");
        backend.db.prepare(`INSERT INTO inventory_movements
          (public_id, tenant_id, organization_id, batch_id, variant_id, kind, quantity_delta, unit_cost, lot_code, expires_on, reason, reversed_from_id, actor_user_id)
          VALUES (?, ?, ?, ?, ?, 'reversal', ?, ?, ?, ?, 'Desfazimento de operação', ?, ?)`)
          .run(randomUUID(), tenantId, organizationId, Number(reversal.lastInsertRowid), movement.variant_id, -movement.quantity_delta,
            movement.unit_cost, movement.lot_code, movement.expires_on, movement.id, userId);
      }
      backend.db.prepare("UPDATE inventory_batches SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP WHERE id = ?").run(original.id);
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return { id: reversalId };
}

export async function createInventoryOrder({ tenantId, userId, type, reference, partner, lines }) {
  const kind = type === "purchase" ? "purchase" : "sale";
  const direction = kind === "purchase" ? 1 : -1;
  const movementLines = lines.map((line) => ({ ...line, delta: Math.abs(line.quantity) * direction }));
  const batch = await applyInventoryBatch({ tenantId, userId, kind, reference, supplier: kind === "purchase" ? partner : "", lines: movementLines });
  const backend = await ensureSchema();
  const orderId = randomUUID();
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  try {
    if (backend.type === "postgres") {
      await backend.sql.transaction((tx) => [
        tx`INSERT INTO inventory_orders (public_id, tenant_id, organization_id, type, reference, partner, total, batch_id, actor_user_id)
          SELECT ${orderId}, ${tenantId}, organization_id, ${type}, ${reference}, ${partner}, ${total}, id, ${userId}
          FROM inventory_batches WHERE public_id = ${batch.id} AND tenant_id = ${tenantId}`,
        ...lines.map((line) => tx`INSERT INTO inventory_order_items (order_id, variant_id, quantity, unit_price)
          SELECT o.id, v.id, ${line.quantity}, ${line.unitPrice} FROM inventory_orders o
          JOIN inventory_variants v ON v.public_id = ${line.variantId} AND v.tenant_id = ${tenantId}
          WHERE o.public_id = ${orderId} AND o.tenant_id = ${tenantId}`),
      ]);
    } else {
      const organizationId = sqliteOrganizationId(backend.db, tenantId);
      const batchRow = backend.db.prepare("SELECT id FROM inventory_batches WHERE public_id = ? AND tenant_id = ?").get(batch.id, tenantId);
      backend.db.exec("BEGIN IMMEDIATE");
      try {
        const order = backend.db.prepare(`INSERT INTO inventory_orders
          (public_id, tenant_id, organization_id, type, reference, partner, total, batch_id, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(orderId, tenantId, organizationId, type, reference, partner, total, batchRow.id, userId);
        const insert = backend.db.prepare(`INSERT INTO inventory_order_items (order_id, variant_id, quantity, unit_price)
          SELECT ?, id, ?, ? FROM inventory_variants WHERE public_id = ? AND tenant_id = ?`);
        for (const line of lines) insert.run(Number(order.lastInsertRowid), line.quantity, line.unitPrice, line.variantId, tenantId);
        backend.db.exec("COMMIT");
      } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
    }
  } catch (error) {
    await undoInventoryBatch({ tenantId, userId, batchPublicId: batch.id }).catch(() => {});
    throw error;
  }
  return { id: orderId, batchId: batch.id, total };
}

export async function resetInventorySchemaForTests() {
  schemaPromise = undefined;
}
