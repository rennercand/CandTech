-- Registra permanentemente na conta que a implantação incluída no primeiro
-- Pix de R$ 180 foi paga. Renovações posteriores cobram apenas a mensalidade.
ALTER TABLE billing_profiles
  ADD COLUMN IF NOT EXISTS setup_paid_at TIMESTAMPTZ;

-- Preserva o estado das contas que já tiveram uma cobrança inicial aprovada
-- antes da criação da coluna.
UPDATE billing_profiles AS billing
SET setup_paid_at = approved.reviewed_at
FROM (
  SELECT user_id, MIN(COALESCE(reviewed_at, updated_at, created_at)) AS reviewed_at
  FROM pix_payment_requests
  WHERE kind = 'initial' AND status = 'approved'
  GROUP BY user_id
) AS approved
WHERE billing.user_id = approved.user_id
  AND billing.setup_paid_at IS NULL;
