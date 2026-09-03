import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";
import { buildInventoryInsights } from "./inventory-insights.js";

let schemaPromise;

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const backend = await getDatabaseBackend();
    // No Neon, as migrations relacionais e de escopo organizacional do estoque
    // são aplicadas antes do deploy. Apenas o SQLite local prepara o schema.
    if (backend.type === "sqlite") {
      backend.db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, organization_id INTEGER NOT NULL,
          name TEXT NOT NULL, document TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', lead_time_days INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_organization_name ON suppliers(organization_id, name COLLATE NOCASE);
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
          restock_reminder_on TEXT,
          unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0), sale_price REAL NOT NULL DEFAULT 0 CHECK(sale_price >= 0),
          location TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, sku),
          FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE CASCADE,
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_inventory_variants_product ON inventory_variants(tenant_id, product_id, active);
        CREATE TABLE IF NOT EXISTS inventory_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, organization_id INTEGER, kind TEXT NOT NULL,
          reference TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL DEFAULT '', supplier_id INTEGER, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
          actor_user_id INTEGER NOT NULL, reversed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(actor_user_id) REFERENCES users(id), FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL);
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
          reference TEXT NOT NULL DEFAULT '', partner TEXT NOT NULL DEFAULT '', customer_id INTEGER, supplier_id INTEGER, status TEXT NOT NULL DEFAULT 'completed',
          subtotal REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'pending', due_on TEXT, idempotency_key_hash TEXT,
          batch_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(batch_id) REFERENCES inventory_batches(id), FOREIGN KEY(actor_user_id) REFERENCES users(id),
          FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL,
          FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
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
      const orderColumns = backend.db.prepare("PRAGMA table_info(inventory_orders)").all();
      if (!orderColumns.some((column) => column.name === "idempotency_key_hash")) {
        backend.db.exec("ALTER TABLE inventory_orders ADD COLUMN idempotency_key_hash TEXT");
      }
      for (const [name, definition] of [
        ["customer_id", "INTEGER"], ["subtotal", "REAL NOT NULL DEFAULT 0"], ["discount_amount", "REAL NOT NULL DEFAULT 0"],
        ["payment_method", "TEXT NOT NULL DEFAULT 'pending'"], ["payment_status", "TEXT NOT NULL DEFAULT 'pending'"], ["due_on", "TEXT"], ["supplier_id", "INTEGER"],
      ]) if (!orderColumns.some((column) => column.name === name)) backend.db.exec(`ALTER TABLE inventory_orders ADD COLUMN ${name} ${definition}`);
      const batchColumns = backend.db.prepare("PRAGMA table_info(inventory_batches)").all();
      if (!batchColumns.some((column) => column.name === "supplier_id")) backend.db.exec("ALTER TABLE inventory_batches ADD COLUMN supplier_id INTEGER");
      const variantColumns = backend.db.prepare("PRAGMA table_info(inventory_variants)").all();
      if (!variantColumns.some((column) => column.name === "restock_reminder_on")) backend.db.exec("ALTER TABLE inventory_variants ADD COLUMN restock_reminder_on TEXT");
      backend.db.exec("UPDATE inventory_orders SET subtotal=total WHERE subtotal=0 AND total>0");
      backend.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_inventory_products_organization ON inventory_products(organization_id, active, name);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_variants_organization_sku ON inventory_variants(organization_id, sku) WHERE organization_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_inventory_variants_organization_product ON inventory_variants(organization_id, product_id, active);
        CREATE INDEX IF NOT EXISTS idx_inventory_variants_organization_restock_alert ON inventory_variants(organization_id, restock_reminder_on, minimum_quantity) WHERE active = 1;
        CREATE INDEX IF NOT EXISTS idx_inventory_batches_organization_created ON inventory_batches(organization_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_batches_organization_supplier ON inventory_batches(organization_id, supplier_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_movements_organization_variant ON inventory_movements(organization_id, variant_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_created ON inventory_orders(organization_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_payment ON inventory_orders(organization_id, payment_status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_supplier ON inventory_orders(organization_id, supplier_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_orders_organization_idempotency
          ON inventory_orders(organization_id, idempotency_key_hash) WHERE idempotency_key_hash IS NOT NULL;
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
    restockReminderOn: row.restock_reminder_on ? String(row.restock_reminder_on).slice(0, 10) : "",
    unitCost: Number(row.unit_cost),
    salePrice: Number(row.sale_price),
    location: row.location || "",
  };
}

export async function listInventory(tenantId) {
  const backend = await ensureSchema();
  let rows; let batches; let orders; let lots; let analyticsRows; let deliveries;
  if (backend.type === "postgres") {
    [rows, batches, orders, lots, analyticsRows, deliveries] = await Promise.all([
      backend.sql`SELECT p.public_id AS product_public_id, p.name AS product_name, p.category, p.unit,
        v.public_id AS variant_public_id, v.name AS variant_name, v.sku, v.quantity, v.minimum_quantity, v.restock_reminder_on,
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
      backend.sql`SELECT o.public_id AS id, o.type, o.reference, o.partner, c.public_id AS customer_id, s.public_id AS supplier_id, o.status,
        o.subtotal, o.discount_amount, o.total, o.payment_method, o.payment_status, o.due_on, o.created_at
        FROM inventory_orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.tenant_id = ${tenantId}
          AND o.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
        ORDER BY o.created_at DESC LIMIT 20`,
      backend.sql`SELECT m.lot_code, m.expires_on, v.public_id AS variant_id, p.name AS product_name,
        v.name AS variant_name, v.sku, SUM(m.quantity_delta) AS available_quantity
        FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
        JOIN inventory_variants v ON v.id = m.variant_id JOIN inventory_products p ON p.id = v.product_id
        WHERE m.tenant_id = ${tenantId}
          AND m.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
          AND b.organization_id IS NOT DISTINCT FROM m.organization_id
          AND v.organization_id IS NOT DISTINCT FROM m.organization_id
          AND (m.lot_code <> '' OR m.expires_on IS NOT NULL)
        GROUP BY m.lot_code, m.expires_on, v.public_id, p.name, v.name, v.sku
        HAVING SUM(m.quantity_delta) > 0
        ORDER BY m.expires_on NULLS LAST, p.name LIMIT 100`,
      backend.sql`SELECT v.public_id AS variant_id, v.created_at,
        COALESCE((SELECT SUM(m.quantity_delta * m.unit_cost) / NULLIF(SUM(m.quantity_delta), 0)
          FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
          WHERE m.variant_id = v.id AND m.quantity_delta > 0 AND m.kind IN ('entry', 'purchase', 'import') AND b.status = 'active'), v.unit_cost) AS average_unit_cost,
        COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM inventory_order_items oi
          JOIN inventory_orders o ON o.id = oi.order_id WHERE oi.variant_id = v.id AND o.type = 'sale' AND o.status = 'completed'), 0) AS sale_revenue,
        (SELECT MAX(o.created_at) FROM inventory_order_items oi JOIN inventory_orders o ON o.id = oi.order_id
          WHERE oi.variant_id = v.id AND o.type = 'sale' AND o.status = 'completed') AS last_sale_at
        FROM inventory_variants v WHERE v.tenant_id = ${tenantId}
          AND v.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text) AND v.active = TRUE`,
      backend.sql`SELECT d.public_id AS id, c.public_id AS client_id, o.public_id::text AS order_id,
        d.description, d.partner, d.direction, d.planned_for, d.status, d.tracking_code, d.proof_blob_path IS NOT NULL AS has_proof
        FROM operational_deliveries d
        LEFT JOIN customers c ON c.id = d.customer_id
        LEFT JOIN inventory_orders o ON o.id = d.inventory_order_id
        WHERE d.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
        ORDER BY CASE WHEN d.status IN ('entregue', 'cancelada') THEN 1 ELSE 0 END, d.planned_for NULLS LAST, d.created_at DESC LIMIT 100`,
    ]);
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    rows = backend.db.prepare(`SELECT p.public_id AS product_public_id, p.name AS product_name, p.category, p.unit,
      v.public_id AS variant_public_id, v.name AS variant_name, v.sku, v.quantity, v.minimum_quantity, v.restock_reminder_on,
      v.unit_cost, v.sale_price, v.location FROM inventory_products p JOIN inventory_variants v ON v.product_id = p.id
      WHERE p.tenant_id = ? AND p.organization_id IS ? AND p.active = 1
        AND v.tenant_id = ? AND v.organization_id IS p.organization_id AND v.active = 1
      ORDER BY p.name, v.name`).all(tenantId, organizationId, tenantId);
    batches = backend.db.prepare(`SELECT b.public_id AS id, b.kind, b.reference, b.supplier, b.note, b.status, b.created_at,
      COUNT(m.id) AS item_count, COALESCE(SUM(ABS(m.quantity_delta)), 0) AS total_units
      FROM inventory_batches b LEFT JOIN inventory_movements m ON m.batch_id = b.id AND m.reversed_from_id IS NULL
      WHERE b.tenant_id = ? AND b.organization_id IS ?
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20`).all(tenantId, organizationId);
    orders = backend.db.prepare(`SELECT o.public_id AS id, o.type, o.reference, o.partner, c.public_id AS customer_id, s.public_id AS supplier_id, o.status,
      o.subtotal, o.discount_amount, o.total, o.payment_method, o.payment_status, o.due_on, o.created_at
      FROM inventory_orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN suppliers s ON s.id=o.supplier_id
      WHERE o.tenant_id = ? AND o.organization_id IS ? ORDER BY o.created_at DESC LIMIT 20`).all(tenantId, organizationId);
    lots = backend.db.prepare(`SELECT m.lot_code, m.expires_on, v.public_id AS variant_id, p.name AS product_name,
      v.name AS variant_name, v.sku, SUM(m.quantity_delta) AS available_quantity
      FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
      JOIN inventory_variants v ON v.id = m.variant_id JOIN inventory_products p ON p.id = v.product_id
      WHERE m.tenant_id = ? AND m.organization_id IS ?
        AND b.organization_id IS m.organization_id AND v.organization_id IS m.organization_id
        AND (m.lot_code <> '' OR m.expires_on IS NOT NULL)
      GROUP BY m.lot_code, m.expires_on, v.public_id, p.name, v.name, v.sku
      HAVING SUM(m.quantity_delta) > 0
      ORDER BY CASE WHEN m.expires_on IS NULL THEN 1 ELSE 0 END, m.expires_on, p.name LIMIT 100`).all(tenantId, organizationId);
    analyticsRows = backend.db.prepare(`SELECT v.public_id AS variant_id, v.created_at,
      COALESCE((SELECT SUM(m.quantity_delta * m.unit_cost) / NULLIF(SUM(m.quantity_delta), 0)
        FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
        WHERE m.variant_id = v.id AND m.quantity_delta > 0 AND m.kind IN ('entry', 'purchase', 'import') AND b.status = 'active'), v.unit_cost) AS average_unit_cost,
      COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM inventory_order_items oi
        JOIN inventory_orders o ON o.id = oi.order_id WHERE oi.variant_id = v.id AND o.type = 'sale' AND o.status = 'completed'), 0) AS sale_revenue,
      (SELECT MAX(o.created_at) FROM inventory_order_items oi JOIN inventory_orders o ON o.id = oi.order_id
        WHERE oi.variant_id = v.id AND o.type = 'sale' AND o.status = 'completed') AS last_sale_at
      FROM inventory_variants v WHERE v.tenant_id = ? AND v.organization_id IS ? AND v.active = 1`).all(tenantId, organizationId);
    deliveries = backend.db.prepare(`SELECT d.public_id AS id, c.public_id AS client_id, d.order_public_id AS order_id,
      d.description, d.partner, d.direction, d.planned_for, d.status, d.tracking_code, d.proof_blob_path IS NOT NULL AS has_proof
      FROM operational_deliveries d LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.organization_id IS ?
      ORDER BY CASE WHEN d.status IN ('entregue', 'cancelada') THEN 1 ELSE 0 END,
        CASE WHEN d.planned_for IS NULL THEN 1 ELSE 0 END, d.planned_for, d.created_at DESC LIMIT 100`).all(organizationId);
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
    orders: orders.map((row) => ({ ...row, subtotal: Number(row.subtotal), discount_amount: Number(row.discount_amount), total: Number(row.total) })),
    lots: lots.map((row) => ({ ...row, available_quantity: Number(row.available_quantity) })),
    insights: buildInventoryInsights(products, analyticsRows),
    deliveries: deliveries.map((row) => ({
      id: row.id, clientId: row.client_id || "", orderId: row.order_id || "", description: row.description || "",
      partner: row.partner || "", direction: row.direction, date: row.planned_for ? String(row.planned_for).slice(0, 10) : "",
      status: row.status, tracking: row.tracking_code || "", hasProof: Boolean(row.has_proof),
    })),
  };
}

export async function getInventoryDailySummary(tenantId, date) {
  const backend = await ensureSchema();
  let row;
  if (backend.type === "postgres") {
    [row] = await backend.sql`SELECT COUNT(*) AS count, COALESCE(SUM(o.subtotal),0) AS gross,
      COALESCE(SUM(o.discount_amount),0) AS discounts, COALESCE(SUM(o.total),0) AS total,
      COALESCE(SUM(cost.total_cost),0) AS cost,
      COUNT(*) FILTER (WHERE o.payment_status='pending') AS pending
      FROM inventory_orders o
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(ABS(m.quantity_delta)*m.unit_cost),0) AS total_cost
        FROM inventory_movements m WHERE m.batch_id=o.batch_id AND m.reversed_from_id IS NULL) cost ON TRUE
      WHERE o.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId}='organization:'||id::text)
        AND o.type='sale' AND o.status='completed'
        AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date=${date}::date`;
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    row = backend.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(o.subtotal),0) AS gross,
      COALESCE(SUM(o.discount_amount),0) AS discounts, COALESCE(SUM(o.total),0) AS total,
      COALESCE(SUM((SELECT COALESCE(SUM(ABS(m.quantity_delta)*m.unit_cost),0) FROM inventory_movements m
        WHERE m.batch_id=o.batch_id AND m.reversed_from_id IS NULL)),0) AS cost,
      COALESCE(SUM(CASE WHEN o.payment_status='pending' THEN 1 ELSE 0 END),0) AS pending
      FROM inventory_orders o WHERE o.organization_id IS ? AND o.type='sale' AND o.status='completed'
        AND substr(o.created_at,1,10)=?`).get(organizationId, date);
  }
  const total = Number(row?.total) || 0;
  const cost = Number(row?.cost) || 0;
  return {
    count: Number(row?.count) || 0,
    gross: Number(row?.gross) || 0,
    discounts: Number(row?.discounts) || 0,
    total,
    cost,
    margin: total - cost,
    pending: Number(row?.pending) || 0,
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
        (public_id, tenant_id, organization_id, product_id, name, sku, minimum_quantity, restock_reminder_on, unit_cost, sale_price, location)
        SELECT ${variant.id}, ${tenantId}, organization_id, id, ${variant.name}, ${variant.sku}, ${variant.minimumQuantity}, ${variant.restockReminderOn || null},
          ${variant.unitCost}, ${variant.salePrice}, ${variant.location}
        FROM inventory_products WHERE public_id = ${product.id} AND tenant_id = ${tenantId}`),
    ]), { isolationLevel: "Serializable" });
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    backend.db.exec("BEGIN IMMEDIATE");
    try {
      const insertProduct = backend.db.prepare("INSERT INTO inventory_products (public_id, tenant_id, organization_id, name, category, unit) VALUES (?, ?, ?, ?, ?, ?)");
      const insertVariant = backend.db.prepare(`INSERT INTO inventory_variants
        (public_id, tenant_id, organization_id, product_id, name, sku, minimum_quantity, restock_reminder_on, unit_cost, sale_price, location)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const product of created) {
        const result = insertProduct.run(product.id, tenantId, organizationId, product.name, product.category, product.unit);
        for (const variant of product.variants) insertVariant.run(variant.id, tenantId, organizationId, Number(result.lastInsertRowid), variant.name,
          variant.sku, variant.minimumQuantity, variant.restockReminderOn || null, variant.unitCost, variant.salePrice, variant.location);
      }
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return created;
}

export async function updateInventoryAlert({ tenantId, variantId, minimumQuantity, restockReminderOn = null }) {
  const backend = await ensureSchema();
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE inventory_variants variant
      SET minimum_quantity = ${minimumQuantity}, restock_reminder_on = ${restockReminderOn}, updated_at = NOW()
      WHERE variant.tenant_id = ${tenantId} AND variant.public_id = ${variantId}
        AND variant.organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
        AND variant.active = TRUE
      RETURNING variant.public_id AS variant_public_id, variant.name AS variant_name, variant.sku, variant.quantity,
        variant.minimum_quantity, variant.restock_reminder_on, variant.unit_cost, variant.sale_price, variant.location`;
    return rows[0] ? serializeVariant(rows[0]) : null;
  }
  const organizationId = sqliteOrganizationId(backend.db, tenantId);
  const changed = backend.db.prepare(`UPDATE inventory_variants SET minimum_quantity = ?, restock_reminder_on = ?, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND organization_id IS ? AND public_id = ? AND active = 1`)
    .run(minimumQuantity, restockReminderOn, tenantId, organizationId, variantId).changes;
  if (!changed) return null;
  const row = backend.db.prepare(`SELECT public_id AS variant_public_id, name AS variant_name, sku, quantity,
    minimum_quantity, restock_reminder_on, unit_cost, sale_price, location FROM inventory_variants
    WHERE tenant_id = ? AND organization_id IS ? AND public_id = ?`).get(tenantId, organizationId, variantId);
  return serializeVariant(row);
}

function combineLines(lines) {
  const combined = new Map();
  for (const line of lines) {
    const key = `${line.variantId}|${line.lotCode || ""}|${line.expiresOn || ""}`;
    const current = combined.get(key);
    combined.set(key, current ? { ...current, delta: current.delta + line.delta, quantity: current.quantity + line.quantity } : { ...line });
  }
  return [...combined.values()];
}

async function allocateFefoLines(backend, tenantId, lines) {
  const organizationId = backend.type === "sqlite" ? sqliteOrganizationId(backend.db, tenantId) : null;
  const allocated = [];
  for (const line of lines) {
    const lots = backend.type === "postgres"
      ? await backend.sql`SELECT m.lot_code, m.expires_on, SUM(m.quantity_delta) AS available_quantity,
          COALESCE(SUM(CASE WHEN m.quantity_delta > 0 THEN m.quantity_delta * m.unit_cost ELSE 0 END) /
            NULLIF(SUM(CASE WHEN m.quantity_delta > 0 THEN m.quantity_delta ELSE 0 END), 0), 0) AS average_unit_cost
          FROM inventory_movements m JOIN inventory_variants v ON v.id = m.variant_id
          WHERE m.tenant_id = ${tenantId} AND v.public_id = ${line.variantId}
            AND m.organization_id IS NOT DISTINCT FROM v.organization_id
          GROUP BY m.lot_code, m.expires_on HAVING SUM(m.quantity_delta) > 0
          ORDER BY CASE WHEN m.expires_on IS NULL THEN 1 ELSE 0 END, m.expires_on, m.lot_code`
      : backend.db.prepare(`SELECT m.lot_code, m.expires_on, SUM(m.quantity_delta) AS available_quantity,
          COALESCE(SUM(CASE WHEN m.quantity_delta > 0 THEN m.quantity_delta * m.unit_cost ELSE 0 END) /
            NULLIF(SUM(CASE WHEN m.quantity_delta > 0 THEN m.quantity_delta ELSE 0 END), 0), 0) AS average_unit_cost
          FROM inventory_movements m JOIN inventory_variants v ON v.id = m.variant_id
          WHERE m.tenant_id = ? AND m.organization_id IS ? AND v.public_id = ? AND v.organization_id IS m.organization_id
          GROUP BY m.lot_code, m.expires_on HAVING SUM(m.quantity_delta) > 0
          ORDER BY CASE WHEN m.expires_on IS NULL OR m.expires_on = '' THEN 1 ELSE 0 END, m.expires_on, m.lot_code`).all(tenantId, organizationId, line.variantId);
    let remaining = Math.abs(Number(line.quantity));
    for (const lot of lots) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, Number(lot.available_quantity));
      if (quantity <= 0) continue;
      allocated.push({ ...line, quantity, delta: -quantity, unitCost: Number(lot.average_unit_cost) || Number(line.unitCost) || 0,
        lotCode: lot.lot_code || "", expiresOn: lot.expires_on ? String(lot.expires_on).slice(0, 10) : "" });
      remaining -= quantity;
    }
    if (remaining > 0) allocated.push({ ...line, quantity: remaining, delta: -remaining, lotCode: "", expiresOn: "" });
  }
  return allocated;
}

export async function applyInventoryBatch({ tenantId, userId, kind, reference = "", supplier = "", supplierId = "", note = "", lines }) {
  const backend = await ensureSchema();
  const safeLines = combineLines(lines);
  const batchId = randomUUID();
  if (backend.type === "postgres") {
    await backend.sql.transaction((tx) => [
      tx`INSERT INTO inventory_batches (public_id, tenant_id, organization_id, kind, reference, supplier, supplier_id, note, actor_user_id)
        VALUES (${batchId}, ${tenantId}, (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text), ${kind}, ${reference}, ${supplier},
          (SELECT s.id FROM suppliers s JOIN organizations o ON o.id=s.organization_id WHERE s.public_id::text=${supplierId || null} AND ${tenantId}='organization:'||o.id::text), ${note}, ${userId})`,
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
        (public_id, tenant_id, organization_id, kind, reference, supplier, supplier_id, note, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(batchId, tenantId, organizationId, kind, reference, supplier,
          supplierId ? backend.db.prepare("SELECT id FROM suppliers WHERE public_id=? AND organization_id=?").get(supplierId, organizationId)?.id || null : null,
          note, userId);
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
  const financialReversalId = randomUUID();
  const cancelEventId = randomUUID();
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
      tx`INSERT INTO financial_ledger_entries(public_id,owner_user_id,organization_id,financial_account_id,direction,occurred_on,category,description,realized_amount,origin_type,origin_public_id)
        SELECT ${financialReversalId},entry.owner_user_id,entry.organization_id,entry.financial_account_id,
          CASE WHEN entry.direction='income' THEN 'expense' ELSE 'income' END,CURRENT_DATE,'Estornos',LEFT('Estorno: '||entry.description,160),entry.realized_amount,'order_reversal',inventory_order.public_id::text
        FROM inventory_orders inventory_order JOIN financial_ledger_entries entry ON entry.origin_type='order' AND entry.origin_public_id=inventory_order.public_id::text
        WHERE inventory_order.tenant_id=${tenantId} AND inventory_order.batch_id=(SELECT id FROM inventory_batches WHERE public_id=${batchPublicId} AND tenant_id=${tenantId})
          AND NOT EXISTS(SELECT 1 FROM financial_ledger_entries reversed WHERE reversed.origin_type='order_reversal' AND reversed.origin_public_id=inventory_order.public_id::text)`,
      tx`UPDATE financial_commitments SET status='cancelled',updated_at=NOW() WHERE status='pending' AND origin_type='order' AND origin_public_id IN
        (SELECT public_id::text FROM inventory_orders WHERE tenant_id=${tenantId} AND batch_id=(SELECT id FROM inventory_batches WHERE public_id=${batchPublicId} AND tenant_id=${tenantId}))`,
      tx`UPDATE inventory_orders SET status = 'cancelled', payment_status=CASE WHEN payment_status='paid' THEN 'refunded' ELSE 'cancelled' END
        WHERE tenant_id = ${tenantId} AND batch_id = (SELECT id FROM inventory_batches WHERE public_id = ${batchPublicId} AND tenant_id = ${tenantId})`,
      tx`UPDATE operational_deliveries SET status = 'cancelada', updated_at = NOW()
        WHERE inventory_order_id IN (SELECT id FROM inventory_orders WHERE tenant_id = ${tenantId}
          AND batch_id = (SELECT id FROM inventory_batches WHERE public_id = ${batchPublicId} AND tenant_id = ${tenantId}))`,
      tx`INSERT INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload)
        SELECT ${cancelEventId},organization_id,'inventory_order',public_id::text,'inventory.order.cancelled',${`inventory:${batchPublicId}:cancelled`},${JSON.stringify({batchPublicId})}::jsonb
        FROM inventory_orders WHERE tenant_id=${tenantId} AND batch_id=(SELECT id FROM inventory_batches WHERE public_id=${batchPublicId} AND tenant_id=${tenantId})
        ON CONFLICT(event_type,dedupe_key) DO NOTHING`,
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
      const order=backend.db.prepare("SELECT public_id,payment_status,organization_id FROM inventory_orders WHERE tenant_id=? AND batch_id=?").get(tenantId,original.id);
      if(order){const entry=backend.db.prepare("SELECT * FROM financial_ledger_entries WHERE origin_type='order' AND origin_public_id=? LIMIT 1").get(order.public_id);if(entry&&!backend.db.prepare("SELECT id FROM financial_ledger_entries WHERE origin_type='order_reversal' AND origin_public_id=?").get(order.public_id))backend.db.prepare(`INSERT INTO financial_ledger_entries(public_id,owner_user_id,organization_id,financial_account_id,direction,occurred_on,category,description,realized_amount,origin_type,origin_public_id) VALUES(?,?,?,?,?,date('now'),'Estornos',?,?,'order_reversal',?)`).run(financialReversalId,entry.owner_user_id,entry.organization_id,entry.financial_account_id,entry.direction==='income'?'expense':'income',`Estorno: ${entry.description}`.slice(0,160),entry.realized_amount,order.public_id);backend.db.prepare("UPDATE financial_commitments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND origin_type='order' AND origin_public_id=?").run(order.public_id);backend.db.prepare("INSERT OR IGNORE INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload) VALUES(?,?,'inventory_order',?,'inventory.order.cancelled',?,?)").run(cancelEventId,order.organization_id,order.public_id,`inventory:${batchPublicId}:cancelled`,JSON.stringify({batchPublicId}));}
      backend.db.prepare("UPDATE inventory_orders SET status='cancelled',payment_status=CASE WHEN payment_status='paid' THEN 'refunded' ELSE 'cancelled' END WHERE tenant_id = ? AND batch_id = ?").run(tenantId, original.id);
      backend.db.prepare(`UPDATE operational_deliveries SET status = 'cancelada', updated_at = CURRENT_TIMESTAMP
        WHERE order_public_id IN (SELECT public_id FROM inventory_orders WHERE tenant_id = ? AND batch_id = ?)`)
        .run(tenantId, original.id);
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return { id: reversalId };
}

export async function createInventoryOrder({ tenantId, userId, type, reference, partner, customerId = "", supplierId = "", lines, discountAmount = 0,
  paymentMethod = "pending", dueOn = null, idempotencyKeyHash = null }) {
  const kind = type === "purchase" ? "purchase" : "sale";
  const direction = kind === "purchase" ? 1 : -1;
  const backend = await ensureSchema();
  const orderId = randomUUID();
  const batchId = randomUUID();
  const eventId = randomUUID();
  const deliveryId = randomUUID();
  const deliveryEventId = randomUUID();
  const financialId = randomUUID();
  const accountId = randomUUID();
  const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const safeDiscount = roundMoney(Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal));
  const total = roundMoney(subtotal - safeDiscount);
  const paymentStatus = paymentMethod === "pending" ? "pending" : "paid";
  if (kind === "purchase" && supplierId) {
    const supplier = backend.type === "postgres"
      ? (await backend.sql`SELECT s.name FROM suppliers s JOIN organizations o ON o.id=s.organization_id
          WHERE s.public_id::text=${supplierId} AND ${tenantId}='organization:'||o.id::text AND s.active=TRUE`)[0]
      : backend.db.prepare("SELECT name FROM suppliers WHERE public_id=? AND organization_id=? AND active=1").get(supplierId, sqliteOrganizationId(backend.db, tenantId));
    if (!supplier) throw new Error("INVALID_SUPPLIER");
    partner = supplier.name;
  }
  if (idempotencyKeyHash) {
    const existing = backend.type === "postgres"
      ? (await backend.sql`SELECT public_id, batch_id, total FROM inventory_orders WHERE tenant_id = ${tenantId} AND idempotency_key_hash = ${idempotencyKeyHash} LIMIT 1`)[0]
      : backend.db.prepare("SELECT public_id, batch_id, total FROM inventory_orders WHERE tenant_id = ? AND idempotency_key_hash = ? LIMIT 1").get(tenantId, idempotencyKeyHash);
    if (existing) {
      const existingBatch = backend.type === "postgres"
        ? (await backend.sql`SELECT public_id FROM inventory_batches WHERE id = ${existing.batch_id}`)[0]
        : backend.db.prepare("SELECT public_id FROM inventory_batches WHERE id = ?").get(existing.batch_id);
      return { id: existing.public_id, batchId: existingBatch.public_id, total: Number(existing.total), replayed: true };
    }
  }
  const movementLines = kind === "sale"
    ? await allocateFefoLines(backend, tenantId, lines)
    : lines.map((line) => ({ ...line, delta: Math.abs(line.quantity) * direction }));
  if (backend.type === "postgres") {
    const safeLines = combineLines(movementLines);
    await backend.sql.transaction((tx) => [
      tx`INSERT INTO inventory_batches (public_id, tenant_id, organization_id, kind, reference, supplier, supplier_id, note, actor_user_id)
        VALUES (${batchId}, ${tenantId}, (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text), ${kind}, ${reference}, ${kind === "purchase" ? partner : ""},
          (SELECT s.id FROM suppliers s JOIN organizations o ON o.id=s.organization_id WHERE s.public_id::text=${kind === "purchase" ? supplierId || null : null} AND ${tenantId}='organization:'||o.id::text), '', ${userId})`,
      ...safeLines.map((line) => tx`WITH changed AS (
        UPDATE inventory_variants SET quantity = quantity + ${line.delta},
          unit_cost = CASE WHEN ${line.delta} > 0 AND ${line.unitCost} > 0 THEN ${line.unitCost} ELSE unit_cost END,
          updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND public_id = ${line.variantId} AND quantity + ${line.delta} >= 0
        RETURNING id
      ) INSERT INTO inventory_movements
        (public_id, tenant_id, organization_id, batch_id, variant_id, kind, quantity_delta, unit_cost, lot_code, expires_on, reason, actor_user_id)
        SELECT ${randomUUID()}, ${tenantId}, b.organization_id, b.id, changed.id, ${kind}, ${line.delta}, ${line.unitCost},
          ${line.lotCode}, ${line.expiresOn || null}, '', ${userId}
        FROM changed CROSS JOIN inventory_batches b WHERE b.public_id = ${batchId} AND b.tenant_id = ${tenantId}`),
      tx`SELECT 1 / CASE WHEN COUNT(*) = ${safeLines.length} THEN 1 ELSE COUNT(*) - COUNT(*) END AS valid
        FROM inventory_movements m JOIN inventory_batches b ON b.id = m.batch_id
        WHERE b.public_id = ${batchId} AND b.tenant_id = ${tenantId}`,
      tx`INSERT INTO inventory_orders (public_id, tenant_id, organization_id, type, reference, partner, customer_id, supplier_id, subtotal, discount_amount,
          total, payment_method, payment_status, due_on, batch_id, actor_user_id, idempotency_key_hash)
        SELECT ${orderId}, ${tenantId}, organization_id, ${type}, ${reference}, ${partner},
          (SELECT id FROM customers WHERE organization_id=inventory_batches.organization_id AND public_id=${customerId || null}),
          (SELECT id FROM suppliers WHERE organization_id=inventory_batches.organization_id AND public_id::text=${kind === "purchase" ? supplierId || null : null}),
          ${subtotal}, ${safeDiscount}, ${total}, ${paymentMethod}, ${paymentStatus}, ${dueOn}, id, ${userId}, ${idempotencyKeyHash}
        FROM inventory_batches WHERE public_id = ${batchId} AND tenant_id = ${tenantId}`,
      ...lines.map((line) => tx`INSERT INTO inventory_order_items (order_id, variant_id, quantity, unit_price)
        SELECT o.id, v.id, ${line.quantity}, ${line.unitPrice} FROM inventory_orders o
        JOIN inventory_variants v ON v.public_id = ${line.variantId} AND v.tenant_id = ${tenantId}
        WHERE o.public_id = ${orderId} AND o.tenant_id = ${tenantId}`),
      ...(total > 0 && paymentStatus === "paid" ? [
        tx`INSERT INTO financial_accounts(public_id,owner_user_id,organization_id,name,kind,currency)
          SELECT ${accountId},owner_user_id,id,'Caixa principal','cash','BRL' FROM organizations WHERE ${tenantId}='organization:'||id::text
          ON CONFLICT(owner_user_id,name) DO NOTHING`,
        tx`INSERT INTO financial_ledger_entries(public_id,owner_user_id,organization_id,financial_account_id,direction,occurred_on,category,description,realized_amount,origin_type,origin_public_id)
          SELECT ${financialId},organization.owner_user_id,inventory_order.organization_id,account.id,${kind === "sale" ? "income" : "expense"},CURRENT_DATE,
            ${kind === "sale" ? "Vendas" : "Compras"},${`${kind === "sale" ? "Venda" : "Compra"} ${reference || orderId.slice(0,8)}`},${total},'order',${orderId}
          FROM inventory_orders inventory_order JOIN organizations organization ON organization.id=inventory_order.organization_id
          JOIN financial_accounts account ON account.owner_user_id=organization.owner_user_id AND account.organization_id=organization.id AND account.name='Caixa principal'
          WHERE inventory_order.public_id=${orderId}`,
      ] : []),
      ...(total > 0 && paymentStatus === "pending" ? [tx`INSERT INTO financial_commitments(public_id,owner_user_id,organization_id,kind,description,party,category,due_on,expected_amount,status,origin_type,origin_public_id)
        SELECT ${financialId},organization.owner_user_id,inventory_order.organization_id,${kind === "sale" ? "receivable" : "payable"},
          ${`${kind === "sale" ? "Venda" : "Compra"} ${reference || orderId.slice(0,8)}`},${partner},${kind === "sale" ? "Vendas" : "Compras"},COALESCE(${dueOn},CURRENT_DATE),${total},'pending','order',${orderId}
        FROM inventory_orders inventory_order JOIN organizations organization ON organization.id=inventory_order.organization_id WHERE inventory_order.public_id=${orderId}`] : []),
      ...(kind === "sale" ? [tx`INSERT INTO operational_deliveries
        (public_id, owner_user_id, organization_id, customer_id, inventory_order_id, description, partner, direction, status)
        SELECT ${deliveryId}, organization.owner_user_id, inventory_order.organization_id, inventory_order.customer_id, inventory_order.id,
          ${`Entrega ${reference || orderId.slice(0, 8)}`}, ${partner}, 'saida', 'preparando'
        FROM inventory_orders inventory_order JOIN organizations organization ON organization.id = inventory_order.organization_id
        WHERE inventory_order.public_id = ${orderId} AND inventory_order.tenant_id = ${tenantId}`] : []),
      tx`INSERT INTO outbox_events (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
        SELECT ${eventId}, organization_id, 'inventory_order', ${orderId}, ${`inventory.order.${type}`}, ${idempotencyKeyHash},
          ${JSON.stringify({ subtotal, discountAmount: safeDiscount, total, reference, paymentMethod, paymentStatus })}::jsonb FROM inventory_orders WHERE public_id = ${orderId}`,
      ...(kind === "sale" ? [tx`INSERT INTO outbox_events
        (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
        SELECT ${deliveryEventId}, organization_id, 'operational_delivery', ${deliveryId}, 'delivery.created',
          ${idempotencyKeyHash ? `${idempotencyKeyHash}:delivery` : null}, ${JSON.stringify({ orderId, reference })}::jsonb
        FROM inventory_orders WHERE public_id = ${orderId}`] : []),
    ], { isolationLevel: "Serializable" });
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    const safeLines = combineLines(movementLines);
    backend.db.exec("BEGIN IMMEDIATE");
    try {
      const batch = backend.db.prepare(`INSERT INTO inventory_batches
        (public_id, tenant_id, organization_id, kind, reference, supplier, supplier_id, note, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`)
        .run(batchId, tenantId, organizationId, kind, reference, kind === "purchase" ? partner : "",
          kind === "purchase" && supplierId ? backend.db.prepare("SELECT id FROM suppliers WHERE public_id=? AND organization_id=?").get(supplierId, organizationId)?.id || null : null,
          userId);
      const update = backend.db.prepare(`UPDATE inventory_variants SET quantity = quantity + ?,
        unit_cost = CASE WHEN ? > 0 AND ? > 0 THEN ? ELSE unit_cost END, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND public_id = ? AND quantity + ? >= 0`);
      const movement = backend.db.prepare(`INSERT INTO inventory_movements
        (public_id, tenant_id, organization_id, batch_id, variant_id, kind, quantity_delta, unit_cost, lot_code, expires_on, reason, actor_user_id)
        SELECT ?, ?, ?, ?, id, ?, ?, ?, ?, ?, '', ? FROM inventory_variants WHERE tenant_id = ? AND public_id = ?`);
      for (const line of safeLines) {
        if (update.run(line.delta, line.delta, line.unitCost, line.unitCost, tenantId, line.variantId, line.delta).changes !== 1) throw new Error("INSUFFICIENT_STOCK_OR_UNKNOWN_VARIANT");
        movement.run(randomUUID(), tenantId, organizationId, Number(batch.lastInsertRowid), kind, line.delta, line.unitCost, line.lotCode, line.expiresOn || null, userId, tenantId, line.variantId);
      }
      const customer = customerId ? backend.db.prepare("SELECT id FROM customers WHERE organization_id IS ? AND public_id=?").get(organizationId,customerId) : null;
      const order = backend.db.prepare(`INSERT INTO inventory_orders
        (public_id, tenant_id, organization_id, type, reference, partner, customer_id, supplier_id, subtotal, discount_amount, total, payment_method, payment_status, due_on, batch_id, actor_user_id, idempotency_key_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(orderId, tenantId, organizationId, type, reference, partner, customer?.id || null,
          kind === "purchase" && supplierId ? backend.db.prepare("SELECT id FROM suppliers WHERE public_id=? AND organization_id=?").get(supplierId, organizationId)?.id || null : null,
          subtotal, safeDiscount, total, paymentMethod, paymentStatus, dueOn,
          Number(batch.lastInsertRowid), userId, idempotencyKeyHash);
      const item = backend.db.prepare(`INSERT INTO inventory_order_items (order_id, variant_id, quantity, unit_price)
        SELECT ?, id, ?, ? FROM inventory_variants WHERE public_id = ? AND tenant_id = ?`);
      for (const line of lines) item.run(Number(order.lastInsertRowid), line.quantity, line.unitPrice, line.variantId, tenantId);
      const owner = backend.db.prepare("SELECT owner_user_id FROM organizations WHERE id = ?").get(organizationId);
      if (total > 0 && paymentStatus === "paid") {
        backend.db.prepare("INSERT OR IGNORE INTO financial_accounts(public_id,owner_user_id,organization_id,name,kind,currency) VALUES(?,?,?,'Caixa principal','cash','BRL')").run(accountId,owner.owner_user_id,organizationId);
        const account=backend.db.prepare("SELECT id FROM financial_accounts WHERE owner_user_id=? AND organization_id IS ? AND name='Caixa principal'").get(owner.owner_user_id,organizationId);
        backend.db.prepare(`INSERT INTO financial_ledger_entries(public_id,owner_user_id,organization_id,financial_account_id,direction,occurred_on,category,description,realized_amount,origin_type,origin_public_id)
          VALUES(?,?,?,?,?,date('now'),?,?,?,'order',?)`).run(financialId,owner.owner_user_id,organizationId,account.id,kind === "sale" ? "income" : "expense",kind === "sale" ? "Vendas" : "Compras",`${kind === "sale" ? "Venda" : "Compra"} ${reference || orderId.slice(0,8)}`,total,orderId);
      } else if (total > 0) {
        backend.db.prepare(`INSERT INTO financial_commitments(public_id,owner_user_id,organization_id,kind,description,party,category,due_on,expected_amount,status,origin_type,origin_public_id)
          VALUES(?,?,?,?,?,?,?,?,?,'pending','order',?)`).run(financialId,owner.owner_user_id,organizationId,kind === "sale" ? "receivable" : "payable",`${kind === "sale" ? "Venda" : "Compra"} ${reference || orderId.slice(0,8)}`,partner,kind === "sale" ? "Vendas" : "Compras",dueOn || new Date().toISOString().slice(0,10),total,orderId);
      }
      if (kind === "sale") {
        backend.db.prepare(`INSERT INTO operational_deliveries
          (public_id, owner_user_id, organization_id, customer_id, order_public_id, description, partner, direction, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'saida', 'preparando')`)
          .run(deliveryId, owner.owner_user_id, organizationId, customer?.id || null, orderId, `Entrega ${reference || orderId.slice(0, 8)}`, partner);
      }
      backend.db.prepare(`INSERT INTO outbox_events (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
        VALUES (?, ?, 'inventory_order', ?, ?, ?, ?)`).run(eventId, organizationId, orderId, `inventory.order.${type}`, idempotencyKeyHash, JSON.stringify({ subtotal, discountAmount: safeDiscount, total, reference, paymentMethod, paymentStatus }));
      if (kind === "sale") backend.db.prepare(`INSERT INTO outbox_events
        (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
        VALUES (?, ?, 'operational_delivery', ?, 'delivery.created', ?, ?)`)
        .run(deliveryEventId, organizationId, deliveryId, idempotencyKeyHash ? `${idempotencyKeyHash}:delivery` : null, JSON.stringify({ orderId, reference }));
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return { id: orderId, batchId, subtotal, discountAmount: safeDiscount, total, paymentMethod, paymentStatus, replayed: false };
}

export async function resetInventorySchemaForTests() {
  schemaPromise = undefined;
}

export async function saveDeliveryProof({ tenantId, deliveryId, storageKey }) {
  const backend = await ensureSchema();
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE operational_deliveries SET proof_blob_path = ${storageKey}, updated_at = NOW()
      WHERE public_id = ${deliveryId}
        AND organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text)
      RETURNING proof_blob_path`;
    return rows[0] || null;
  }
  const organizationId = sqliteOrganizationId(backend.db, tenantId);
  const previous = backend.db.prepare("SELECT proof_blob_path FROM operational_deliveries WHERE public_id = ? AND organization_id IS ?").get(deliveryId, organizationId);
  if (!previous) return null;
  backend.db.prepare("UPDATE operational_deliveries SET proof_blob_path = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ? AND organization_id IS ?")
    .run(storageKey, deliveryId, organizationId);
  return { previous_storage_key: previous.proof_blob_path || null };
}

export async function getDeliveryProof({ tenantId, deliveryId }) {
  const backend = await ensureSchema();
  if (backend.type === "postgres") return (await backend.sql`SELECT proof_blob_path
    FROM operational_deliveries WHERE public_id = ${deliveryId}
      AND organization_id IS NOT DISTINCT FROM (SELECT id FROM organizations WHERE ${tenantId} = 'organization:' || id::text) LIMIT 1`)[0] || null;
  const organizationId = sqliteOrganizationId(backend.db, tenantId);
  return backend.db.prepare("SELECT proof_blob_path FROM operational_deliveries WHERE public_id = ? AND organization_id IS ?").get(deliveryId, organizationId) || null;
}
