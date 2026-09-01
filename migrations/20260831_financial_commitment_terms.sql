ALTER TABLE financial_commitments
  ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS series_public_id TEXT,
  ADD COLUMN IF NOT EXISTS recurrence VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS installment_number SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS installment_count SMALLINT NOT NULL DEFAULT 1;

UPDATE financial_commitments
SET paid_amount = GREATEST(expected_amount + interest_amount + penalty_amount - discount_amount, 0)
WHERE status IN ('paid', 'received') AND paid_amount = 0;

ALTER TABLE financial_commitments
  DROP CONSTRAINT IF EXISTS financial_commitments_adjustments_nonnegative,
  DROP CONSTRAINT IF EXISTS financial_commitments_recurrence_check,
  DROP CONSTRAINT IF EXISTS financial_commitments_installments_check;

ALTER TABLE financial_commitments
  ADD CONSTRAINT financial_commitments_adjustments_nonnegative
    CHECK (interest_amount >= 0 AND penalty_amount >= 0 AND discount_amount >= 0 AND paid_amount >= 0),
  ADD CONSTRAINT financial_commitments_recurrence_check
    CHECK (recurrence IN ('none', 'weekly', 'monthly', 'yearly')),
  ADD CONSTRAINT financial_commitments_installments_check
    CHECK (installment_number BETWEEN 1 AND 60 AND installment_count BETWEEN 1 AND 60 AND installment_number <= installment_count);

CREATE INDEX IF NOT EXISTS idx_financial_commitments_series
  ON financial_commitments (owner_user_id, organization_id, series_public_id, installment_number)
  WHERE series_public_id IS NOT NULL;
