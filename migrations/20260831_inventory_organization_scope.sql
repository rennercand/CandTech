ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE inventory_variants
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE inventory_batches
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE inventory_orders
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE inventory_products product
SET organization_id = organization.id
FROM organizations organization
WHERE product.organization_id IS NULL
  AND product.tenant_id = 'organization:' || organization.id::text;

UPDATE inventory_batches batch
SET organization_id = organization.id
FROM organizations organization
WHERE batch.organization_id IS NULL
  AND batch.tenant_id = 'organization:' || organization.id::text;

UPDATE inventory_variants variant
SET organization_id = product.organization_id
FROM inventory_products product
WHERE variant.organization_id IS NULL
  AND variant.product_id = product.id
  AND variant.tenant_id = product.tenant_id;

UPDATE inventory_movements movement
SET organization_id = batch.organization_id
FROM inventory_batches batch, inventory_variants variant
WHERE movement.organization_id IS NULL
  AND movement.batch_id = batch.id
  AND movement.variant_id = variant.id
  AND movement.tenant_id = batch.tenant_id
  AND movement.tenant_id = variant.tenant_id
  AND batch.organization_id IS NOT DISTINCT FROM variant.organization_id;

UPDATE inventory_orders inventory_order
SET organization_id = batch.organization_id
FROM inventory_batches batch
WHERE inventory_order.organization_id IS NULL
  AND inventory_order.batch_id = batch.id
  AND inventory_order.tenant_id = batch.tenant_id;

CREATE INDEX IF NOT EXISTS idx_inventory_products_organization
  ON inventory_products (organization_id, active, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_variants_organization_sku
  ON inventory_variants (organization_id, sku)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_variants_organization_product
  ON inventory_variants (organization_id, product_id, active);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_organization_created
  ON inventory_batches (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_organization_variant
  ON inventory_movements (organization_id, variant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_created
  ON inventory_orders (organization_id, created_at DESC);
