CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(24) NOT NULL DEFAULT '',
  contact_name VARCHAR(120) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days BETWEEN 0 AND 365),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_organization_name
  ON suppliers (organization_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_suppliers_organization_active
  ON suppliers (organization_id, active, name);

ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS supplier_id BIGINT;
ALTER TABLE inventory_orders ADD COLUMN IF NOT EXISTS supplier_id BIGINT;

ALTER TABLE inventory_batches DROP CONSTRAINT IF EXISTS inventory_batches_supplier_id_fkey;
ALTER TABLE inventory_batches ADD CONSTRAINT inventory_batches_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE inventory_orders DROP CONSTRAINT IF EXISTS inventory_orders_supplier_id_fkey;
ALTER TABLE inventory_orders ADD CONSTRAINT inventory_orders_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_batches_organization_supplier
  ON inventory_batches (organization_id, supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_supplier
  ON inventory_orders (organization_id, supplier_id, created_at DESC);
