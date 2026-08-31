ALTER TABLE histories
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE histories h
SET organization_id = o.id
FROM organizations o
WHERE h.organization_id IS NULL
  AND o.owner_user_id = h.user_id;

UPDATE workspaces w
SET organization_id = o.id
FROM organizations o
WHERE w.organization_id IS NULL
  AND o.owner_user_id = w.user_id;

CREATE INDEX IF NOT EXISTS idx_histories_organization_created
  ON histories (organization_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_workspaces_organization
  ON workspaces (organization_id);
