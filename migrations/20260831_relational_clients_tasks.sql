CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS clients_relational_at TIMESTAMPTZ;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS tasks_relational_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(24) NOT NULL DEFAULT '',
  email VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lead', 'inactive')),
  notes VARCHAR(240) NOT NULL DEFAULT '',
  original_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, public_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_organization_status
  ON customers (organization_id, status, name);

CREATE TABLE IF NOT EXISTS operational_tasks (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  title VARCHAR(120) NOT NULL,
  due_date DATE,
  priority VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status VARCHAR(16) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  original_created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, public_id)
);

CREATE INDEX IF NOT EXISTS idx_operational_tasks_organization_status_due
  ON operational_tasks (organization_id, status, due_date);

WITH extracted AS (
  SELECT DISTINCT ON (workspace.user_id, COALESCE(NULLIF(client.value->>'id', ''), client.ordinality::text))
    workspace.user_id AS owner_user_id,
    workspace.organization_id,
    COALESCE(NULLIF(LEFT(client.value->>'id', 120), ''), gen_random_uuid()::text) AS public_id,
    LEFT(BTRIM(COALESCE(client.value->>'name', '')), 100) AS name,
    LEFT(BTRIM(COALESCE(client.value->>'phone', '')), 24) AS phone,
    LEFT(BTRIM(COALESCE(client.value->>'email', '')), 160) AS email,
    CASE WHEN client.value->>'status' IN ('active', 'lead', 'inactive') THEN client.value->>'status' ELSE 'active' END AS status,
    LEFT(BTRIM(COALESCE(client.value->>'notes', '')), 240) AS notes,
    CASE WHEN client.value->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (client.value->>'createdAt')::timestamptz END AS original_created_at
  FROM workspaces workspace
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(workspace.payload->'clients') = 'array' THEN workspace.payload->'clients' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS client(value, ordinality)
)
INSERT INTO customers (
  public_id, owner_user_id, organization_id, name, phone, email, status, notes, original_created_at
)
SELECT public_id, owner_user_id, organization_id, name, phone, email, status, notes, original_created_at
FROM extracted
WHERE name <> ''
ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes,
  original_created_at = COALESCE(customers.original_created_at, EXCLUDED.original_created_at),
  updated_at = NOW()
WHERE customers.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id;

WITH extracted AS (
  SELECT DISTINCT ON (workspace.user_id, COALESCE(NULLIF(task.value->>'id', ''), task.ordinality::text))
    workspace.user_id AS owner_user_id,
    workspace.organization_id,
    COALESCE(NULLIF(LEFT(task.value->>'id', 120), ''), gen_random_uuid()::text) AS public_id,
    NULLIF(LEFT(task.value->>'clientId', 120), '') AS customer_public_id,
    LEFT(BTRIM(COALESCE(task.value->>'title', '')), 120) AS title,
    CASE WHEN task.value->>'dueDate' ~ '^\d{4}-\d{2}-\d{2}$' THEN (task.value->>'dueDate')::date END AS due_date,
    CASE WHEN task.value->>'priority' IN ('low', 'medium', 'high') THEN task.value->>'priority' ELSE 'medium' END AS priority,
    CASE WHEN task.value->>'status' IN ('todo', 'doing', 'done') THEN task.value->>'status' ELSE 'todo' END AS status,
    CASE WHEN task.value->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (task.value->>'createdAt')::timestamptz END AS original_created_at,
    CASE WHEN task.value->>'completedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (task.value->>'completedAt')::timestamptz END AS completed_at
  FROM workspaces workspace
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(workspace.payload->'tasks') = 'array' THEN workspace.payload->'tasks' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS task(value, ordinality)
)
INSERT INTO operational_tasks (
  public_id, owner_user_id, organization_id, customer_id, title, due_date,
  priority, status, original_created_at, completed_at
)
SELECT extracted.public_id, extracted.owner_user_id, extracted.organization_id, customer.id,
       extracted.title, extracted.due_date, extracted.priority, extracted.status,
       extracted.original_created_at, extracted.completed_at
FROM extracted
LEFT JOIN customers customer
  ON customer.owner_user_id = extracted.owner_user_id
 AND customer.organization_id IS NOT DISTINCT FROM extracted.organization_id
 AND customer.public_id = extracted.customer_public_id
WHERE extracted.title <> ''
ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  title = EXCLUDED.title,
  due_date = EXCLUDED.due_date,
  priority = EXCLUDED.priority,
  status = EXCLUDED.status,
  original_created_at = COALESCE(operational_tasks.original_created_at, EXCLUDED.original_created_at),
  completed_at = EXCLUDED.completed_at,
  updated_at = NOW()
WHERE operational_tasks.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id;

UPDATE workspaces
SET clients_relational_at = COALESCE(clients_relational_at, NOW()),
    tasks_relational_at = COALESCE(tasks_relational_at, NOW());
