ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;
ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS provider_price_id TEXT;
ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
