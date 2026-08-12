CREATE TABLE IF NOT EXISTS monitoring_events (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL UNIQUE,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'info')),
  source TEXT NOT NULL,
  code TEXT NOT NULL,
  summary TEXT NOT NULL,
  route TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  occurrences INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_status_seen ON monitoring_events (status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id BIGINT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  preferred_channel TEXT NOT NULL DEFAULT 'site' CHECK (preferred_channel IN ('site', 'email', 'phone')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  admin_reply TEXT NOT NULL DEFAULT '',
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated ON support_tickets (status, updated_at DESC);
