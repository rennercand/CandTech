import { getDatabaseBackend } from "./db.js";

function serialize(row) {
  if (!row) return null;
  return {
    userId: Number(row.user_id),
    name: row.name || "",
    email: row.email || "",
    emailVerified: !row.email_verification_required || Boolean(row.email_verified_at),
    canMonitor: Boolean(row.can_monitor),
    canSupport: Boolean(row.can_support),
    canBilling: Boolean(row.can_billing),
    grantedBy: Number(row.granted_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getStaffAccessByUserId(userId) {
  const backend = await getDatabaseBackend();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT * FROM staff_access WHERE user_id=${userId}`)[0]
    : backend.db.prepare("SELECT * FROM staff_access WHERE user_id=?").get(userId);
  return serialize(row);
}

export async function listStaffAccess() {
  const backend = await getDatabaseBackend();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT s.*, u.name, u.email, u.email_verified_at, u.email_verification_required
        FROM staff_access s JOIN users u ON u.id=s.user_id
        WHERE u.account_status='active' ORDER BY LOWER(u.email)`
    : backend.db.prepare(`SELECT s.*, u.name, u.email, u.email_verified_at, u.email_verification_required
        FROM staff_access s JOIN users u ON u.id=s.user_id
        WHERE u.account_status='active' ORDER BY LOWER(u.email)`).all();
  return rows.map(serialize);
}

export async function saveStaffAccessByEmail({ email, canMonitor, canSupport, canBilling, grantedBy }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const backend = await getDatabaseBackend();
  const user = backend.type === "postgres"
    ? (await backend.sql`SELECT id, name, email, email_verified_at, email_verification_required
        FROM users WHERE account_status='active' AND LOWER(BTRIM(email))=${normalizedEmail}`)[0]
    : backend.db.prepare(`SELECT id, name, email, email_verified_at, email_verification_required
        FROM users WHERE account_status='active' AND LOWER(TRIM(email))=?`).get(normalizedEmail);
  if (!user) return null;
  // Uma conta ainda não verificada não pode receber privilégios internos. O
  // administrador tenta novamente depois que o titular confirma o próprio e-mail.
  if (user.email_verification_required && !user.email_verified_at) return null;

  const values = { canMonitor: Boolean(canMonitor), canSupport: Boolean(canSupport), canBilling: Boolean(canBilling) };
  if (!values.canMonitor && !values.canSupport && !values.canBilling) {
    await revokeStaffAccess(Number(user.id));
    return { ...serialize({ ...user, user_id: user.id, granted_by: grantedBy, can_monitor: false, can_support: false, can_billing: false }), revoked: true };
  }

  if (backend.type === "postgres") {
    const rows = await backend.sql`INSERT INTO staff_access (user_id, can_monitor, can_support, can_billing, granted_by)
      VALUES (${user.id}, ${values.canMonitor}, ${values.canSupport}, ${values.canBilling}, ${grantedBy})
      ON CONFLICT (user_id) DO UPDATE SET can_monitor=EXCLUDED.can_monitor, can_support=EXCLUDED.can_support,
        can_billing=EXCLUDED.can_billing, granted_by=EXCLUDED.granted_by, updated_at=NOW()
      RETURNING *`;
    return serialize({ ...rows[0], ...user });
  }
  backend.db.prepare(`INSERT INTO staff_access (user_id, can_monitor, can_support, can_billing, granted_by)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET can_monitor=excluded.can_monitor,
      can_support=excluded.can_support, can_billing=excluded.can_billing, granted_by=excluded.granted_by,
      updated_at=CURRENT_TIMESTAMP`).run(user.id, Number(values.canMonitor), Number(values.canSupport), Number(values.canBilling), grantedBy);
  const row = backend.db.prepare("SELECT * FROM staff_access WHERE user_id=?").get(user.id);
  return serialize({ ...row, ...user });
}

export async function revokeStaffAccess(userId) {
  const backend = await getDatabaseBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`DELETE FROM staff_access WHERE user_id=${userId} RETURNING user_id`;
    return rows.length > 0;
  }
  return backend.db.prepare("DELETE FROM staff_access WHERE user_id=?").run(userId).changes > 0;
}
