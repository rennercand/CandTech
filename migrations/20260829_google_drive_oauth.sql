CREATE TABLE IF NOT EXISTS oauth_transactions (
  nonce_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_transactions_active
  ON oauth_transactions (user_id, provider, expires_at) WHERE used_at IS NULL;
