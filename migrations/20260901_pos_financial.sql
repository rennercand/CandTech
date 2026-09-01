ALTER TABLE inventory_orders
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS due_on DATE;

UPDATE inventory_orders
SET subtotal = total
WHERE subtotal = 0 AND total > 0;

ALTER TABLE inventory_orders
  DROP CONSTRAINT IF EXISTS inventory_orders_discount_valid,
  DROP CONSTRAINT IF EXISTS inventory_orders_payment_method_valid,
  DROP CONSTRAINT IF EXISTS inventory_orders_payment_status_valid;

ALTER TABLE inventory_orders
  ADD CONSTRAINT inventory_orders_discount_valid
    CHECK (subtotal >= 0 AND discount_amount >= 0 AND discount_amount <= subtotal AND total = subtotal - discount_amount),
  ADD CONSTRAINT inventory_orders_payment_method_valid
    CHECK (payment_method IN ('pending','cash','pix','debit','credit','transfer','other')),
  ADD CONSTRAINT inventory_orders_payment_status_valid
    CHECK (payment_status IN ('pending','paid','refunded','cancelled'));

CREATE INDEX IF NOT EXISTS idx_inventory_orders_organization_payment
  ON inventory_orders (organization_id, payment_status, created_at DESC);

