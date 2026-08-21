-- Normaliza a identidade de login e preserva dados de contas antigas duplicadas.
-- Este reparo é executado somente como migration controlada, nunca no runtime.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';

WITH ranked AS (
  SELECT u.id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(BTRIM(u.email))
      ORDER BY
        EXISTS (
          SELECT 1 FROM billing_profiles b
          WHERE b.user_id = u.id AND b.subscription_status IN ('active', 'trialing')
        ) DESC,
        (u.email_verified_at IS NOT NULL) DESC,
        EXISTS (SELECT 1 FROM organizations o WHERE o.owner_user_id = u.id) DESC,
        EXISTS (SELECT 1 FROM workspaces w WHERE w.user_id = u.id) DESC,
        (SELECT COUNT(*) FROM histories h WHERE h.user_id = u.id) DESC,
        u.created_at,
        u.id
    ) AS position
  FROM users u
  WHERE u.account_status = 'active'
), archived AS (
  UPDATE users u
  SET email = 'archived-duplicate-' || u.id || '@invalid.candtech.local',
      password_hash = '!archived-duplicate-account!',
      account_status = 'archived_duplicate'
  FROM ranked r
  WHERE u.id = r.id AND r.position > 1
  RETURNING u.id
)
UPDATE auth_sessions s
SET revoked_at = COALESCE(s.revoked_at, NOW())
WHERE s.user_id IN (SELECT id FROM archived);

UPDATE auth_action_tokens t
SET used_at = COALESCE(t.used_at, NOW())
WHERE EXISTS (
  SELECT 1 FROM users u
  WHERE u.id = t.user_id AND u.account_status = 'archived_duplicate'
);

UPDATE users SET email = LOWER(BTRIM(email)) WHERE account_status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users ((LOWER(BTRIM(email))));
