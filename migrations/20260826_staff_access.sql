-- Contas internas reutilizam o login normal e recebem somente os privilégios
-- necessários. O administrador principal continua definido em ADMIN_EMAILS e
-- é o único autorizado a conceder ou revogar estes acessos.
CREATE TABLE IF NOT EXISTS staff_access (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_monitor BOOLEAN NOT NULL DEFAULT FALSE,
  can_support BOOLEAN NOT NULL DEFAULT FALSE,
  can_billing BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (can_monitor OR can_support OR can_billing)
);

CREATE INDEX IF NOT EXISTS idx_staff_access_permissions
  ON staff_access (can_monitor, can_support, can_billing);
