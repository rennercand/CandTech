CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS finance_relational_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS financial_accounts (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash', 'bank', 'other')),
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_organization
  ON financial_accounts (organization_id, active, name);

CREATE TABLE IF NOT EXISTS financial_commitments (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('payable', 'receivable')),
  description VARCHAR(160) NOT NULL DEFAULT '',
  party VARCHAR(120) NOT NULL DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT 'Geral',
  due_on DATE,
  expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'received', 'cancelled')),
  settled_at TIMESTAMPTZ,
  origin_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  origin_public_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, public_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_commitments_organization_status_due
  ON financial_commitments (organization_id, status, due_on);

CREATE TABLE IF NOT EXISTS financial_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  financial_account_id BIGINT NOT NULL REFERENCES financial_accounts(id),
  commitment_id BIGINT REFERENCES financial_commitments(id) ON DELETE SET NULL,
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('income', 'expense')),
  occurred_on DATE,
  category VARCHAR(50) NOT NULL DEFAULT 'Geral',
  description VARCHAR(160) NOT NULL DEFAULT '',
  realized_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (realized_amount >= 0),
  origin_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  origin_public_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, public_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_organization_date
  ON financial_ledger_entries (organization_id, occurred_on DESC, id DESC);

INSERT INTO financial_accounts (public_id, owner_user_id, organization_id, name, kind, currency)
SELECT gen_random_uuid(), workspace.user_id, workspace.organization_id, 'Caixa principal', 'cash', 'BRL'
FROM workspaces workspace
ON CONFLICT (owner_user_id, name) DO UPDATE SET updated_at = financial_accounts.updated_at
WHERE financial_accounts.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id;

WITH extracted AS (
  SELECT DISTINCT ON (workspace.user_id, COALESCE(NULLIF(commitment.value->>'id', ''), commitment.ordinality::text))
    workspace.user_id AS owner_user_id,
    workspace.organization_id,
    COALESCE(NULLIF(LEFT(commitment.value->>'id', 120), ''), gen_random_uuid()::text) AS public_id,
    CASE WHEN commitment.value->>'type' = 'receber' THEN 'receivable' ELSE 'payable' END AS kind,
    LEFT(BTRIM(COALESCE(commitment.value->>'description', '')), 160) AS description,
    LEFT(BTRIM(COALESCE(commitment.value->>'party', '')), 120) AS party,
    COALESCE(NULLIF(LEFT(BTRIM(commitment.value->>'category'), 50), ''), 'Geral') AS category,
    CASE WHEN commitment.value->>'dueDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (commitment.value->>'dueDate')::date END AS due_on,
    GREATEST(CASE WHEN commitment.value->>'amount' ~ '^\d+(\.\d+)?$' THEN (commitment.value->>'amount')::numeric ELSE 0 END, 0) AS expected_amount,
    CASE
      WHEN commitment.value->>'type' = 'receber' AND commitment.value->>'status' = 'recebido' THEN 'received'
      WHEN commitment.value->>'type' <> 'receber' AND commitment.value->>'status' = 'pago' THEN 'paid'
      ELSE 'pending'
    END AS status,
    CASE WHEN commitment.value->>'postedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (commitment.value->>'postedAt')::timestamptz END AS settled_at,
    CASE WHEN NULLIF(commitment.value->>'sourceOrderKey', '') IS NOT NULL THEN 'order' ELSE 'manual' END AS origin_type,
    NULLIF(LEFT(commitment.value->>'sourceOrderKey', 120), '') AS origin_public_id
  FROM workspaces workspace
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(workspace.payload->'financialAccounts') = 'array' THEN workspace.payload->'financialAccounts' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS commitment(value, ordinality)
)
INSERT INTO financial_commitments (
  public_id, owner_user_id, organization_id, kind, description, party, category,
  due_on, expected_amount, status, settled_at, origin_type, origin_public_id
)
SELECT public_id, owner_user_id, organization_id, kind, description, party, category,
       due_on, expected_amount, status, settled_at, origin_type, origin_public_id
FROM extracted
WHERE description <> '' OR party <> '' OR expected_amount > 0
ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
  kind=EXCLUDED.kind, description=EXCLUDED.description, party=EXCLUDED.party,
  category=EXCLUDED.category, due_on=EXCLUDED.due_on,
  expected_amount=EXCLUDED.expected_amount, status=EXCLUDED.status,
  settled_at=EXCLUDED.settled_at, origin_type=EXCLUDED.origin_type,
  origin_public_id=EXCLUDED.origin_public_id, updated_at=NOW()
WHERE financial_commitments.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id;

WITH extracted AS (
  SELECT DISTINCT ON (workspace.user_id, COALESCE(NULLIF(entry.value->>'id', ''), entry.ordinality::text))
    workspace.user_id AS owner_user_id,
    workspace.organization_id,
    COALESCE(NULLIF(LEFT(entry.value->>'id', 120), ''), gen_random_uuid()::text) AS public_id,
    CASE WHEN entry.value->>'type' = 'saida' THEN 'expense' ELSE 'income' END AS direction,
    CASE WHEN entry.value->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (entry.value->>'date')::date END AS occurred_on,
    COALESCE(NULLIF(LEFT(BTRIM(entry.value->>'category'), 50), ''), 'Geral') AS category,
    LEFT(BTRIM(COALESCE(entry.value->>'description', '')), 160) AS description,
    GREATEST(CASE WHEN entry.value->>'amount' ~ '^\d+(\.\d+)?$' THEN (entry.value->>'amount')::numeric ELSE 0 END, 0) AS realized_amount,
    CASE
      WHEN NULLIF(entry.value->>'sourceCommitmentId', '') IS NOT NULL THEN 'commitment'
      WHEN NULLIF(entry.value->>'sourceOrderKey', '') IS NOT NULL THEN 'order'
      ELSE 'manual'
    END AS origin_type,
    COALESCE(NULLIF(LEFT(entry.value->>'sourceCommitmentId', 120), ''), NULLIF(LEFT(entry.value->>'sourceOrderKey', 120), '')) AS origin_public_id
  FROM workspaces workspace
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(workspace.payload->'cashEntries') = 'array' THEN workspace.payload->'cashEntries' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS entry(value, ordinality)
)
INSERT INTO financial_ledger_entries (
  public_id, owner_user_id, organization_id, financial_account_id, commitment_id,
  direction, occurred_on, category, description, realized_amount, origin_type, origin_public_id
)
SELECT extracted.public_id, extracted.owner_user_id, extracted.organization_id, account.id,
       commitment.id, extracted.direction, extracted.occurred_on, extracted.category,
       extracted.description, extracted.realized_amount, extracted.origin_type, extracted.origin_public_id
FROM extracted
JOIN financial_accounts account
  ON account.owner_user_id = extracted.owner_user_id
 AND account.organization_id IS NOT DISTINCT FROM extracted.organization_id
 AND account.name = 'Caixa principal'
LEFT JOIN financial_commitments commitment
  ON extracted.origin_type = 'commitment'
 AND commitment.owner_user_id = extracted.owner_user_id
 AND commitment.organization_id IS NOT DISTINCT FROM extracted.organization_id
 AND commitment.public_id = extracted.origin_public_id
WHERE extracted.description <> '' OR extracted.realized_amount > 0
ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
  financial_account_id=EXCLUDED.financial_account_id,
  commitment_id=EXCLUDED.commitment_id, direction=EXCLUDED.direction,
  occurred_on=EXCLUDED.occurred_on, category=EXCLUDED.category,
  description=EXCLUDED.description, realized_amount=EXCLUDED.realized_amount,
  origin_type=EXCLUDED.origin_type, origin_public_id=EXCLUDED.origin_public_id,
  updated_at=NOW()
WHERE financial_ledger_entries.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id;

UPDATE workspaces
SET finance_relational_at = COALESCE(finance_relational_at, NOW());
