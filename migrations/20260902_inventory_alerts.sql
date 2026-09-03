-- Preferências de reposição por SKU. A quantidade mínima já existia; a data
-- permite um lembrete operacional mesmo antes de o saldo atingir o limite.

ALTER TABLE inventory_variants
  ADD COLUMN IF NOT EXISTS restock_reminder_on DATE;

CREATE INDEX IF NOT EXISTS idx_inventory_variants_organization_restock_alert
  ON inventory_variants (organization_id, restock_reminder_on, minimum_quantity)
  WHERE active = TRUE;
