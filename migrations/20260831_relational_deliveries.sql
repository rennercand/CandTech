CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS deliveries_relational_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS operational_deliveries (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  inventory_order_id BIGINT REFERENCES inventory_orders(id) ON DELETE SET NULL,
  description VARCHAR(160) NOT NULL DEFAULT '',
  partner VARCHAR(120) NOT NULL DEFAULT '',
  direction VARCHAR(12) NOT NULL DEFAULT 'saida' CHECK (direction IN ('entrada', 'saida')),
  planned_for DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'preparando' CHECK (status IN ('preparando', 'em-transito', 'entregue', 'cancelada')),
  tracking_code VARCHAR(120) NOT NULL DEFAULT '',
  proof_blob_path TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, public_id)
);

CREATE INDEX IF NOT EXISTS idx_operational_deliveries_organization_status_date
  ON operational_deliveries (organization_id, status, planned_for);

WITH extracted AS (
  SELECT DISTINCT ON (workspace.user_id, COALESCE(NULLIF(delivery.value->>'id', ''), delivery.ordinality::text))
    workspace.user_id AS owner_user_id,
    workspace.organization_id,
    COALESCE(NULLIF(LEFT(delivery.value->>'id', 120), ''), gen_random_uuid()::text) AS public_id,
    NULLIF(LEFT(delivery.value->>'clientId', 120), '') AS customer_public_id,
    CASE
      WHEN delivery.value->>'orderId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN delivery.value->>'orderId'
    END AS order_public_id,
    LEFT(BTRIM(COALESCE(delivery.value->>'description', '')), 160) AS description,
    LEFT(BTRIM(COALESCE(delivery.value->>'partner', '')), 120) AS partner,
    CASE WHEN delivery.value->>'direction' IN ('entrada', 'saida') THEN delivery.value->>'direction' ELSE 'saida' END AS direction,
    CASE WHEN delivery.value->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (delivery.value->>'date')::date END AS planned_for,
    CASE WHEN delivery.value->>'status' IN ('preparando', 'em-transito', 'entregue', 'cancelada') THEN delivery.value->>'status' ELSE 'preparando' END AS status,
    LEFT(BTRIM(COALESCE(delivery.value->>'tracking', '')), 120) AS tracking_code,
    workspace.updated_at
  FROM workspaces workspace
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(workspace.payload->'inventoryState'->'deliveries') = 'array'
      THEN workspace.payload->'inventoryState'->'deliveries'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS delivery(value, ordinality)
)
INSERT INTO operational_deliveries (
  public_id, owner_user_id, organization_id, customer_id, inventory_order_id,
  description, partner, direction, planned_for, status, tracking_code, delivered_at
)
SELECT extracted.public_id, extracted.owner_user_id, extracted.organization_id,
       customer.id, inventory_order.id, extracted.description, extracted.partner,
       extracted.direction, extracted.planned_for, extracted.status, extracted.tracking_code,
       CASE WHEN extracted.status = 'entregue' THEN extracted.updated_at END
FROM extracted
LEFT JOIN customers customer
  ON customer.owner_user_id = extracted.owner_user_id
 AND customer.organization_id IS NOT DISTINCT FROM extracted.organization_id
 AND customer.public_id = extracted.customer_public_id
LEFT JOIN inventory_orders inventory_order
  ON inventory_order.public_id::text = extracted.order_public_id
WHERE extracted.description <> '' OR extracted.partner <> '' OR extracted.tracking_code <> ''
ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  inventory_order_id = EXCLUDED.inventory_order_id,
  description = EXCLUDED.description,
  partner = EXCLUDED.partner,
  direction = EXCLUDED.direction,
  planned_for = EXCLUDED.planned_for,
  status = EXCLUDED.status,
  tracking_code = EXCLUDED.tracking_code,
  delivered_at = CASE
    WHEN EXCLUDED.status = 'entregue' THEN COALESCE(operational_deliveries.delivered_at, EXCLUDED.delivered_at, NOW())
    ELSE NULL
  END,
  updated_at = NOW()
WHERE operational_deliveries.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id;

UPDATE workspaces
SET deliveries_relational_at = COALESCE(deliveries_relational_at, NOW());
