CREATE TABLE IF NOT EXISTS inventory_products (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'un',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_products_tenant ON inventory_products (tenant_id, active, name);

CREATE TABLE IF NOT EXISTS inventory_variants (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Padrão',
  sku TEXT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  sale_price NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  location TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_product ON inventory_variants (tenant_id, product_id, active);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('entry', 'import', 'sale', 'purchase', 'adjustment', 'reversal')),
  reference TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_tenant ON inventory_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  batch_id BIGINT NOT NULL REFERENCES inventory_batches(id),
  variant_id BIGINT NOT NULL REFERENCES inventory_variants(id),
  kind TEXT NOT NULL,
  quantity_delta NUMERIC(18,3) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  lot_code TEXT NOT NULL DEFAULT '',
  expires_on DATE,
  reason TEXT NOT NULL DEFAULT '',
  reversed_from_id BIGINT REFERENCES inventory_movements(id),
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_variant ON inventory_movements (tenant_id, variant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_orders (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'purchase')),
  reference TEXT NOT NULL DEFAULT '',
  partner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  total NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  batch_id BIGINT NOT NULL REFERENCES inventory_batches(id),
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_orders_tenant ON inventory_orders (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES inventory_orders(id) ON DELETE CASCADE,
  variant_id BIGINT NOT NULL REFERENCES inventory_variants(id),
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0)
);
