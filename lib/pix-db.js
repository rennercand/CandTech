import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";
import { pixAmounts, pixRequestTtlHours } from "./pix.js";

let schemaPromise;

async function ensurePixSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const backend = await getDatabaseBackend();
    if (backend.type === "postgres") {
      await backend.sql`
        CREATE TABLE IF NOT EXISTS pix_payment_requests (
          id BIGSERIAL PRIMARY KEY,
          public_id TEXT NOT NULL UNIQUE,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          kind TEXT NOT NULL CHECK (kind IN ('initial', 'renewal')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
          txid TEXT NOT NULL UNIQUE,
          due_at TIMESTAMPTZ NOT NULL,
          reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at TIMESTAMPTZ,
          backup_sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await backend.sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_payment_one_pending ON pix_payment_requests (user_id) WHERE status = 'pending'`;
      await backend.sql`CREATE INDEX IF NOT EXISTS idx_pix_payment_status_due ON pix_payment_requests (status, due_at)`;
    } else {
      backend.db.exec(`
        CREATE TABLE IF NOT EXISTS pix_payment_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
          kind TEXT NOT NULL CHECK(kind IN ('initial','renewal')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
          txid TEXT NOT NULL UNIQUE, due_at TEXT NOT NULL, reviewed_by INTEGER, reviewed_at TEXT,
          backup_sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_payment_one_pending ON pix_payment_requests(user_id) WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_pix_payment_status_due ON pix_payment_requests(status, due_at);
      `);
    }
    return backend;
  })();
  return schemaPromise;
}

function serialize(row) {
  if (!row) return null;
  return {
    id: row.public_id,
    userId: Number(row.user_id),
    amountCents: Number(row.amount_cents),
    kind: row.kind,
    status: row.status,
    txid: row.txid,
    dueAt: row.due_at,
    reviewedAt: row.reviewed_at || null,
    backupSentAt: row.backup_sent_at || null,
    createdAt: row.created_at,
    customer: row.user_email ? { name: row.user_name || "", email: row.user_email, phone: row.user_phone || "" } : undefined,
  };
}

async function setPendingBilling(backend, userId, request) {
  if (backend.type === "postgres") {
    await backend.sql`
      INSERT INTO billing_profiles (user_id, account_type, payment_provider, provider_subscription_id, provider_price_id, subscription_status)
      SELECT id, account_type, 'pix', ${request.publicId}, ${request.kind},
        CASE WHEN COALESCE((SELECT subscription_status FROM billing_profiles WHERE user_id = ${userId}), '') = 'active'
          AND COALESCE((SELECT subscription_current_period_end FROM billing_profiles WHERE user_id = ${userId}), NOW()) > NOW()
          THEN 'active' ELSE 'pending_payment' END
      FROM users WHERE id = ${userId}
      ON CONFLICT (user_id) DO UPDATE SET payment_provider = 'pix', provider_subscription_id = EXCLUDED.provider_subscription_id,
        provider_price_id = EXCLUDED.provider_price_id,
        subscription_status = CASE WHEN billing_profiles.subscription_status = 'active'
          AND COALESCE(billing_profiles.subscription_current_period_end, NOW()) > NOW()
          THEN 'active' ELSE 'pending_payment' END, updated_at = NOW()
    `;
  } else {
    const current = backend.db.prepare("SELECT subscription_status, subscription_current_period_end FROM billing_profiles WHERE user_id = ?").get(userId);
    const remainsActive = current?.subscription_status === "active" && current.subscription_current_period_end && new Date(current.subscription_current_period_end) > new Date();
    backend.db.prepare(`INSERT INTO billing_profiles (user_id, account_type, payment_provider, provider_subscription_id, provider_price_id, subscription_status)
      SELECT id, account_type, 'pix', ?, ?, ? FROM users WHERE id = ?
      ON CONFLICT(user_id) DO UPDATE SET payment_provider='pix', provider_subscription_id=excluded.provider_subscription_id,
      provider_price_id=excluded.provider_price_id, subscription_status=excluded.subscription_status, updated_at=CURRENT_TIMESTAMP`)
      .run(request.publicId, request.kind, remainsActive ? "active" : "pending_payment", userId);
  }
}

export async function createOrGetPixPaymentRequest(userId) {
  const backend = await ensurePixSchema();
  const now = new Date();
  // Libera o índice de pendência quando o próprio usuário retorna depois do prazo.
  // O cron continuará responsável pelo backup e pela tentativa idempotente de e-mail.
  if (backend.type === "postgres") {
    await backend.sql`UPDATE pix_payment_requests SET status='expired', updated_at=NOW() WHERE user_id=${userId} AND status='pending' AND due_at <= NOW()`;
  } else {
    backend.db.prepare("UPDATE pix_payment_requests SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='pending' AND datetime(due_at) <= CURRENT_TIMESTAMP").run(userId);
  }
  const existing = backend.type === "postgres"
    ? (await backend.sql`SELECT * FROM pix_payment_requests WHERE user_id = ${userId} AND status = 'pending' AND due_at > NOW() ORDER BY created_at DESC LIMIT 1`)[0]
    : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE user_id = ? AND status = 'pending' AND datetime(due_at) > CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1").get(userId);
  if (existing) return { payment: serialize(existing), created: false };

  const approved = backend.type === "postgres"
    ? Number((await backend.sql`SELECT COUNT(*)::int AS count FROM pix_payment_requests WHERE user_id = ${userId} AND status = 'approved'`)[0].count)
    : Number(backend.db.prepare("SELECT COUNT(*) AS count FROM pix_payment_requests WHERE user_id = ? AND status = 'approved'").get(userId).count);
  const amounts = pixAmounts();
  const kind = approved > 0 ? "renewal" : "initial";
  const publicId = randomUUID();
  const txid = `CT${publicId.replace(/-/g, "").slice(0, 23)}`;
  const amountCents = amounts.monthly + (kind === "initial" ? amounts.setup : 0);
  const dueAt = new Date(now.getTime() + pixRequestTtlHours() * 60 * 60 * 1000).toISOString();
  try {
    let row;
    if (backend.type === "postgres") {
      row = (await backend.sql`INSERT INTO pix_payment_requests (public_id, user_id, amount_cents, kind, txid, due_at)
        VALUES (${publicId}, ${userId}, ${amountCents}, ${kind}, ${txid}, ${dueAt}) RETURNING *`)[0];
    } else {
      backend.db.prepare("INSERT INTO pix_payment_requests (public_id, user_id, amount_cents, kind, txid, due_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(publicId, userId, amountCents, kind, txid, dueAt);
      row = backend.db.prepare("SELECT * FROM pix_payment_requests WHERE public_id = ?").get(publicId);
    }
    await setPendingBilling(backend, userId, { publicId, kind });
    return { payment: serialize(row), created: true };
  } catch (error) {
    const concurrent = backend.type === "postgres"
      ? (await backend.sql`SELECT * FROM pix_payment_requests WHERE user_id = ${userId} AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)[0]
      : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(userId);
    if (concurrent) return { payment: serialize(concurrent), created: false };
    throw error;
  }
}

export async function getLatestPixPayment(userId) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT * FROM pix_payment_requests WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`)[0]
    : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId);
  return serialize(row);
}

export async function listPixPaymentsForAdmin() {
  const backend = await ensurePixSchema();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT p.*, u.name AS user_name, u.email AS user_email, COALESCE(b.phone, '') AS user_phone
      FROM pix_payment_requests p JOIN users u ON u.id = p.user_id LEFT JOIN billing_profiles b ON b.user_id = p.user_id
      ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 200`
    : backend.db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email, COALESCE(b.phone, '') AS user_phone
      FROM pix_payment_requests p JOIN users u ON u.id=p.user_id LEFT JOIN billing_profiles b ON b.user_id=p.user_id
      ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 200`).all();
  return rows.map(serialize);
}

export async function reviewPixPayment({ id, approved, administratorId }) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT * FROM pix_payment_requests WHERE public_id = ${id} AND status = 'pending'`)[0]
    : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE public_id = ? AND status = 'pending'").get(id);
  if (!row) return null;
  const nextStatus = approved ? "approved" : "rejected";
  const currentBilling = backend.type === "postgres"
    ? (await backend.sql`SELECT subscription_current_period_end FROM billing_profiles WHERE user_id = ${row.user_id}`)[0]
    : backend.db.prepare("SELECT subscription_current_period_end FROM billing_profiles WHERE user_id = ?").get(row.user_id);
  const base = currentBilling?.subscription_current_period_end && new Date(currentBilling.subscription_current_period_end) > new Date()
    ? new Date(currentBilling.subscription_current_period_end) : new Date();
  const periodEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (backend.type === "postgres") {
    await backend.sql`UPDATE pix_payment_requests SET status=${nextStatus}, reviewed_by=${administratorId}, reviewed_at=NOW(), updated_at=NOW() WHERE id=${row.id} AND status='pending'`;
    await backend.sql`UPDATE billing_profiles SET payment_provider='pix', subscription_status=${approved ? "active" : "canceled"},
      subscription_current_period_end=${approved ? periodEnd : null}, updated_at=NOW() WHERE user_id=${row.user_id}`;
  } else {
    backend.db.prepare("UPDATE pix_payment_requests SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'")
      .run(nextStatus, administratorId, row.id);
    backend.db.prepare("UPDATE billing_profiles SET payment_provider='pix', subscription_status=?, subscription_current_period_end=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
      .run(approved ? "active" : "canceled", approved ? periodEnd : null, row.user_id);
  }
  return getPixPaymentById(id);
}

export async function getPixPaymentById(id) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT p.*, u.name AS user_name, u.email AS user_email, COALESCE(b.phone, '') AS user_phone
      FROM pix_payment_requests p JOIN users u ON u.id=p.user_id LEFT JOIN billing_profiles b ON b.user_id=p.user_id WHERE p.public_id=${id}`)[0]
    : backend.db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email, COALESCE(b.phone, '') AS user_phone
      FROM pix_payment_requests p JOIN users u ON u.id=p.user_id LEFT JOIN billing_profiles b ON b.user_id=p.user_id WHERE p.public_id=?`).get(id);
  return serialize(row);
}

export async function expirePixPayments() {
  const backend = await ensurePixSchema();
  const rows = backend.type === "postgres"
    ? await backend.sql`UPDATE pix_payment_requests SET status='expired', updated_at=NOW() WHERE status='pending' AND due_at <= NOW() RETURNING *`
    : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE status='pending' AND datetime(due_at) <= CURRENT_TIMESTAMP").all();
  if (backend.type === "sqlite") {
    backend.db.prepare("UPDATE pix_payment_requests SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND datetime(due_at) <= CURRENT_TIMESTAMP").run();
  }
  for (const row of rows) {
    if (backend.type === "postgres") await backend.sql`UPDATE billing_profiles SET subscription_status='past_due', subscription_current_period_end=NULL, updated_at=NOW() WHERE user_id=${row.user_id}`;
    else backend.db.prepare("UPDATE billing_profiles SET subscription_status='past_due', subscription_current_period_end=NULL, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(row.user_id);
  }
  return rows.map(serialize);
}

export async function listPixPaymentsAwaitingBackup() {
  const backend = await ensurePixSchema();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT p.*, u.name AS user_name, u.email AS user_email FROM pix_payment_requests p JOIN users u ON u.id=p.user_id
      WHERE p.status IN ('rejected','expired') AND p.backup_sent_at IS NULL ORDER BY p.updated_at LIMIT 20`
    : backend.db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email FROM pix_payment_requests p JOIN users u ON u.id=p.user_id
      WHERE p.status IN ('rejected','expired') AND p.backup_sent_at IS NULL ORDER BY p.updated_at LIMIT 20`).all();
  return rows.map(serialize);
}

export async function markPixBackupSent(id) {
  const backend = await ensurePixSchema();
  if (backend.type === "postgres") await backend.sql`UPDATE pix_payment_requests SET backup_sent_at=NOW(), updated_at=NOW() WHERE public_id=${id} AND backup_sent_at IS NULL`;
  else backend.db.prepare("UPDATE pix_payment_requests SET backup_sent_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE public_id=? AND backup_sent_at IS NULL").run(id);
}

export function resetPixSchemaForTests() { schemaPromise = undefined; }
