ALTER TABLE inventory_orders
  ADD COLUMN IF NOT EXISTS idempotency_key_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_orders_organization_idempotency
  ON inventory_orders (organization_id, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;
