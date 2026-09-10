import { getDatabaseBackend } from "./db.js";

export async function listAdminAccounts({ after = 0, activeOnly = false } = {}) {
  const backend = await getDatabaseBackend();
  const rows = backend.type === "postgres" ? await backend.sql`
    SELECT u.id, u.name, u.account_status, u.email_verified_at,
      COALESCE(o.name, u.name) AS company, m.role,
      EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL
        AND s.expires_at>NOW() AND s.last_seen_at>NOW()-INTERVAL '15 minutes') AS recent
    FROM users u LEFT JOIN organization_members m ON m.user_id=u.id AND m.status='active'
    LEFT JOIN organizations o ON o.id=m.organization_id
    WHERE u.id>${after} AND (${activeOnly}=FALSE OR (u.account_status='active' AND EXISTS
      (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL
      AND s.expires_at>NOW() AND s.last_seen_at>NOW()-INTERVAL '15 minutes')))
    ORDER BY u.id LIMIT 51
  ` : backend.db.prepare(`
    SELECT u.id, u.name, u.account_status, u.email_verified_at,
      COALESCE(o.name, u.name) AS company, m.role,
      EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>CURRENT_TIMESTAMP AND datetime(s.last_seen_at)>datetime('now','-15 minutes')) AS recent
    FROM users u LEFT JOIN organization_members m ON m.user_id=u.id AND m.status='active'
    LEFT JOIN organizations o ON o.id=m.organization_id
    WHERE u.id>? AND (?=0 OR (u.account_status='active' AND EXISTS
      (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL
      AND datetime(s.expires_at)>CURRENT_TIMESTAMP AND datetime(s.last_seen_at)>datetime('now','-15 minutes'))))
    ORDER BY u.id LIMIT 51
  `).all(after, activeOnly ? 1 : 0);
  return { accounts: rows.slice(0, 50).map(row => ({ id: Number(row.id), name: row.name, company: row.company,
    active: row.account_status === "active", recentlyActive: Boolean(row.recent),
    owner: !row.role || row.role === "owner", emailVerified: Boolean(row.email_verified_at) })),
    next: rows.length > 50 ? Number(rows[49].id) : null };
}
