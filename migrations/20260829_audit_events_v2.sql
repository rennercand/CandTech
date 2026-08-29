-- Enriquece a trilha de auditoria sem remover os campos legados.
-- Execute com a credencial administrativa; a aplicação continua sem DDL.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'application';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_version SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS subject_type TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS subject_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS previous_state JSONB;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS new_state JSONB;

UPDATE audit_events SET actor_user_id = user_id WHERE actor_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created
  ON audit_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_created
  ON audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_subject_created
  ON audit_events (subject_type, subject_id, created_at DESC);
