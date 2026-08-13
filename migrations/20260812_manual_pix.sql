-- Fluxo Pix manual: o aplicativo gera a cobrança, mas apenas o administrador
-- pode confirmar o recebimento. Não há confirmação baseada no navegador.
CREATE TABLE IF NOT EXISTS pix_payment_requests (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'renewal')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  txid TEXT NOT NULL UNIQUE,
  due_at TIMESTAMPTZ NOT NULL,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  backup_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_payment_one_pending ON pix_payment_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pix_payment_status_due ON pix_payment_requests (status, due_at);
