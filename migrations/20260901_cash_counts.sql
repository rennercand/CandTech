CREATE TABLE IF NOT EXISTS cash_counts (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  financial_account_id BIGINT NOT NULL REFERENCES financial_accounts(id),
  business_date DATE NOT NULL,
  expected_amount NUMERIC(18,2) NOT NULL,
  counted_amount NUMERIC(18,2) NOT NULL,
  difference_amount NUMERIC(18,2) NOT NULL,
  note VARCHAR(240) NOT NULL DEFAULT '',
  actor_user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_counts_organization_date
  ON cash_counts (organization_id, business_date DESC, created_at DESC);
