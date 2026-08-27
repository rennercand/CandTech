-- Comprovantes Pix permanecem em armazenamento privado. Esta tabela guarda
-- apenas vínculo, metadados e a referência opaca do objeto.
ALTER TABLE pix_payment_requests
  DROP CONSTRAINT IF EXISTS pix_payment_requests_status_check;
ALTER TABLE pix_payment_requests
  ADD CONSTRAINT pix_payment_requests_status_check
  CHECK (status IN ('pending', 'payment_review', 'approved', 'rejected', 'expired'));

DROP INDEX IF EXISTS idx_pix_payment_one_pending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_payment_one_open
  ON pix_payment_requests (user_id)
  WHERE status IN ('pending', 'payment_review');

CREATE TABLE IF NOT EXISTS pix_payment_receipts (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  payment_id BIGINT NOT NULL REFERENCES pix_payment_requests(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256 TEXT NOT NULL CHECK (char_length(sha256) = 64),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_receipt_one_active
  ON pix_payment_receipts (payment_id)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pix_receipt_payment_uploaded
  ON pix_payment_receipts (payment_id, uploaded_at DESC);
