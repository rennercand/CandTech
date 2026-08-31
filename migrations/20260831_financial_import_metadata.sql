ALTER TABLE financial_ledger_entries
  ADD COLUMN IF NOT EXISTS import_batch_public_id TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint CHAR(64),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_financial_ledger_import_batch
  ON financial_ledger_entries (owner_user_id, organization_id, import_batch_public_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_ledger_import_fingerprint
  ON financial_ledger_entries (owner_user_id, COALESCE(organization_id, 0), fingerprint)
  WHERE fingerprint IS NOT NULL;

ALTER TABLE financial_ledger_entries
  DROP CONSTRAINT IF EXISTS financial_ledger_entries_fingerprint_format;

ALTER TABLE financial_ledger_entries
  ADD CONSTRAINT financial_ledger_entries_fingerprint_format
  CHECK (fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{64}$');
