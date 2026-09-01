CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS service_orders (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  financial_commitment_id BIGINT REFERENCES financial_commitments(id) ON DELETE SET NULL,
  series_public_id UUID,
  recurrence VARCHAR(12) NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','weekly','monthly','yearly')),
  recurrence_index INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_index BETWEEN 1 AND 60),
  recurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_count BETWEEN 1 AND 60),
  quote_number VARCHAR(40) NOT NULL DEFAULT '',
  title VARCHAR(140) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee VARCHAR(120) NOT NULL DEFAULT '',
  location VARCHAR(180) NOT NULL DEFAULT '',
  scheduled_for TIMESTAMPTZ,
  due_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('quote','draft','approved','scheduled','in_progress','completed','cancelled')),
  quoted_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (quoted_amount >= 0),
  estimated_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  actual_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
  notes TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_orders_organization_schedule
  ON service_orders (organization_id, status, scheduled_for, id);
CREATE INDEX IF NOT EXISTS idx_service_orders_organization_customer
  ON service_orders (organization_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_order_items (
  id BIGSERIAL PRIMARY KEY,
  service_order_id BIGINT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('service','material')),
  description VARCHAR(160) NOT NULL,
  inventory_variant_id BIGINT REFERENCES inventory_variants(id) ON DELETE RESTRICT,
  quantity NUMERIC(18,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS idx_service_order_items_order ON service_order_items (service_order_id, id);
