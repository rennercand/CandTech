import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";

function sqliteOrganizationId(db, tenantId) {
  return db.prepare("SELECT id FROM organizations WHERE ? = 'organization:' || CAST(id AS TEXT)").get(tenantId)?.id || null;
}

async function ensureSqliteSchema(backend) {
  if (backend.type !== "sqlite") return;
  backend.db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE,
      organization_id INTEGER NOT NULL, name TEXT NOT NULL, document TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_time_days BETWEEN 0 AND 365),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_organization_name ON suppliers(organization_id, name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_suppliers_organization_active ON suppliers(organization_id, active, name);
  `);
  const inventoryTables = new Set(backend.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventory_batches','inventory_orders')").all().map((row) => row.name));
  for (const table of inventoryTables) {
    const columns = backend.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === "supplier_id")) backend.db.exec(`ALTER TABLE ${table} ADD COLUMN supplier_id INTEGER`);
  }
  if (inventoryTables.has("inventory_batches")) backend.db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_batches_organization_supplier ON inventory_batches(organization_id, supplier_id, created_at DESC)");
  if (inventoryTables.has("inventory_orders")) backend.db.exec("CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_supplier ON inventory_orders(organization_id, supplier_id, created_at DESC)");
}

function serialize(row) {
  return {
    id: row.public_id, name: row.name, document: row.document || "", contactName: row.contact_name || "",
    email: row.email || "", phone: row.phone || "", leadTimeDays: Number(row.lead_time_days) || 0,
    purchaseCount: Number(row.purchase_count) || 0, totalPurchased: Number(row.total_purchased) || 0,
    lastPurchaseAt: row.last_purchase_at || null,
  };
}

export async function listSuppliers(tenantId) {
  const backend = await getDatabaseBackend();
  await ensureSqliteSchema(backend);
  const hasInventoryOrders = backend.type === "postgres" || Boolean(backend.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_orders'").get());
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT s.*, COUNT(o.id) FILTER (WHERE o.status='completed') AS purchase_count,
        COALESCE(SUM(o.total) FILTER (WHERE o.status='completed'),0) AS total_purchased,
        MAX(o.created_at) FILTER (WHERE o.status='completed') AS last_purchase_at
      FROM suppliers s LEFT JOIN inventory_orders o ON o.supplier_id=s.id AND o.organization_id=s.organization_id AND o.type='purchase'
      WHERE s.organization_id=(SELECT id FROM organizations WHERE ${tenantId}='organization:'||id::text) AND s.active=TRUE
      GROUP BY s.id ORDER BY s.name LIMIT 500`
    : hasInventoryOrders ? backend.db.prepare(`SELECT s.*, COUNT(CASE WHEN o.status='completed' THEN 1 END) AS purchase_count,
        COALESCE(SUM(CASE WHEN o.status='completed' THEN o.total ELSE 0 END),0) AS total_purchased,
        MAX(CASE WHEN o.status='completed' THEN o.created_at END) AS last_purchase_at
      FROM suppliers s LEFT JOIN inventory_orders o ON o.supplier_id=s.id AND o.organization_id=s.organization_id AND o.type='purchase'
      WHERE s.organization_id=? AND s.active=1 GROUP BY s.id ORDER BY s.name LIMIT 500`)
      .all(sqliteOrganizationId(backend.db, tenantId))
      : backend.db.prepare("SELECT s.*, 0 AS purchase_count, 0 AS total_purchased, NULL AS last_purchase_at FROM suppliers s WHERE s.organization_id=? AND s.active=1 ORDER BY s.name LIMIT 500")
        .all(sqliteOrganizationId(backend.db, tenantId));
  return rows.map(serialize);
}

export async function saveSupplier({ tenantId, data }) {
  const backend = await getDatabaseBackend();
  await ensureSqliteSchema(backend);
  const publicId = randomUUID();
  let row;
  if (backend.type === "postgres") {
    [row] = await backend.sql`INSERT INTO suppliers
      (public_id,organization_id,name,document,contact_name,email,phone,lead_time_days)
      SELECT ${publicId},id,${data.name},${data.document},${data.contactName},${data.email},${data.phone},${data.leadTimeDays}
      FROM organizations WHERE ${tenantId}='organization:'||id::text RETURNING *`;
  } else {
    const organizationId = sqliteOrganizationId(backend.db, tenantId);
    backend.db.prepare(`INSERT INTO suppliers(public_id,organization_id,name,document,contact_name,email,phone,lead_time_days)
      VALUES(?,?,?,?,?,?,?,?)`).run(publicId, organizationId, data.name, data.document, data.contactName, data.email, data.phone, data.leadTimeDays);
    row = backend.db.prepare("SELECT * FROM suppliers WHERE public_id=? AND organization_id=?").get(publicId, organizationId);
  }
  return serialize(row);
}
