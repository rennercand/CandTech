-- Schema mínimo de uma instalação nova. Execute antes das migrations seguintes.
-- O runtime da aplicação não possui nem precisa de privilégios CREATE/ALTER/DROP.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'person',
  email_verified_at TIMESTAMPTZ,
  email_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
  legal_accepted_at TIMESTAMPTZ,
  terms_version TEXT,
  privacy_version TEXT,
  account_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS histories (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  calculation_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  archived_revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (rate_key, window_start)
);

CREATE TABLE IF NOT EXISTS google_drive_connections (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_user_created
  ON audit_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_user_document_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.calculation_type <> 'rascunho-automatico' THEN
    PERFORM pg_advisory_xact_lock(NEW.user_id);
    IF (
      SELECT COUNT(*) FROM histories
      WHERE user_id = NEW.user_id AND calculation_type <> 'rascunho-automatico'
    ) >= 10 THEN
      RAISE EXCEPTION 'document_limit_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'histories_document_limit') THEN
    CREATE TRIGGER histories_document_limit
    BEFORE INSERT ON histories
    FOR EACH ROW EXECUTE FUNCTION enforce_user_document_limit();
  END IF;
END $$;
