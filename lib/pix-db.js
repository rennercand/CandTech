import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";
import { pixAmounts, pixRequestTtlHours } from "./pix.js";

let schemaPromise;

async function ensurePixSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const backend = await getDatabaseBackend();
    // No Neon, a migration 20260812_manual_pix.sql é aplicada antes do
    // deploy. Apenas o SQLite local cria tabelas automaticamente.
    if (backend.type === "sqlite") {
      backend.db.exec(`
        CREATE TABLE IF NOT EXISTS pix_payment_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
          kind TEXT NOT NULL CHECK(kind IN ('initial','renewal')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','payment_review','approved','rejected','expired')),
          txid TEXT NOT NULL UNIQUE, due_at TEXT NOT NULL, reviewed_by INTEGER, reviewed_at TEXT,
          backup_sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      const schema = backend.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pix_payment_requests'").get()?.sql || "";
      if (!schema.includes("payment_review")) {
        // SQLite não altera CHECK constraints. A reconstrução fica restrita ao
        // fallback local; o Neon usa exclusivamente a migration versionada.
        backend.db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
        try {
          backend.db.exec(`
            ALTER TABLE pix_payment_requests RENAME TO pix_payment_requests_legacy;
            CREATE TABLE pix_payment_requests (
              id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE,
              user_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
              kind TEXT NOT NULL CHECK(kind IN ('initial','renewal')),
              status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','payment_review','approved','rejected','expired')),
              txid TEXT NOT NULL UNIQUE, due_at TEXT NOT NULL, reviewed_by INTEGER, reviewed_at TEXT,
              backup_sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
            );
            INSERT INTO pix_payment_requests SELECT * FROM pix_payment_requests_legacy;
            DROP TABLE pix_payment_requests_legacy;
            COMMIT;
          `);
        } catch (error) {
          backend.db.exec("ROLLBACK;");
          throw error;
        } finally {
          backend.db.exec("PRAGMA foreign_keys=ON;");
        }
      }
      backend.db.exec(`
        DROP INDEX IF EXISTS idx_pix_payment_one_pending;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_payment_one_open ON pix_payment_requests(user_id) WHERE status IN ('pending','payment_review');
        CREATE INDEX IF NOT EXISTS idx_pix_payment_status_due ON pix_payment_requests(status, due_at);
        CREATE TABLE IF NOT EXISTS pix_payment_receipts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE,
          payment_id INTEGER NOT NULL, organization_id INTEGER,
          storage_key TEXT NOT NULL UNIQUE, original_filename TEXT NOT NULL,
          content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
          size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 5242880),
          sha256 TEXT NOT NULL CHECK(length(sha256) = 64), uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          uploaded_by_user_id INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
          FOREIGN KEY(payment_id) REFERENCES pix_payment_requests(id) ON DELETE CASCADE,
          FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
          FOREIGN KEY(uploaded_by_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_receipt_one_active ON pix_payment_receipts(payment_id) WHERE active=1;
        CREATE INDEX IF NOT EXISTS idx_pix_receipt_payment_uploaded ON pix_payment_receipts(payment_id, uploaded_at DESC);
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
    receipt: row.receipt_public_id ? {
      id: row.receipt_public_id,
      originalFilename: row.receipt_original_filename,
      contentType: row.receipt_content_type,
      sizeBytes: Number(row.receipt_size_bytes),
      uploadedAt: row.receipt_uploaded_at,
    } : null,
    customer: row.user_email ? {
      name: row.user_name || "",
      email: row.user_email,
    } : undefined,
  };
}

function serializeReceipt(row, { includeStorage = false } = {}) {
  if (!row?.receipt_public_id && !row?.public_id) return null;
  return {
    id: row.receipt_public_id || row.public_id,
    originalFilename: row.receipt_original_filename || row.original_filename,
    contentType: row.receipt_content_type || row.content_type,
    sizeBytes: Number(row.receipt_size_bytes ?? row.size_bytes),
    sha256: row.receipt_sha256 || row.sha256,
    uploadedAt: row.receipt_uploaded_at || row.uploaded_at,
    ...(includeStorage ? { storageKey: row.receipt_storage_key || row.storage_key } : {}),
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
    ? (await backend.sql`SELECT * FROM pix_payment_requests WHERE user_id = ${userId} AND status IN ('pending','payment_review') ORDER BY created_at DESC LIMIT 1`)[0]
    : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE user_id = ? AND status IN ('pending','payment_review') ORDER BY created_at DESC LIMIT 1").get(userId);
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
      ? (await backend.sql`SELECT * FROM pix_payment_requests WHERE user_id = ${userId} AND status IN ('pending','payment_review') ORDER BY created_at DESC LIMIT 1`)[0]
      : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE user_id = ? AND status IN ('pending','payment_review') ORDER BY created_at DESC LIMIT 1").get(userId);
    if (concurrent) return { payment: serialize(concurrent), created: false };
    throw error;
  }
}

export async function getLatestPixPayment(userId) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT p.*, r.public_id AS receipt_public_id, r.original_filename AS receipt_original_filename,
        r.content_type AS receipt_content_type, r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=TRUE
      WHERE p.user_id=${userId} ORDER BY p.created_at DESC LIMIT 1`)[0]
    : backend.db.prepare(`SELECT p.*, r.public_id AS receipt_public_id, r.original_filename AS receipt_original_filename,
        r.content_type AS receipt_content_type, r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=1
      WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 1`).get(userId);
  return serialize(row);
}

export async function listPixPaymentsForAdmin() {
  const backend = await ensurePixSchema();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT p.*, u.name AS user_name, u.email AS user_email,
        r.public_id AS receipt_public_id,
        r.original_filename AS receipt_original_filename, r.content_type AS receipt_content_type,
        r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p JOIN users u ON u.id = p.user_id
      LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=TRUE
      ORDER BY CASE p.status WHEN 'payment_review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.created_at DESC LIMIT 200`
    : backend.db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email,
        r.public_id AS receipt_public_id,
        r.original_filename AS receipt_original_filename, r.content_type AS receipt_content_type,
        r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p JOIN users u ON u.id=p.user_id
      LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=1
      ORDER BY CASE p.status WHEN 'payment_review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, p.created_at DESC LIMIT 200`).all();
  return rows.map(serialize);
}

export async function getOwnedPixPaymentForReceipt({ id, userId }) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT p.id, p.public_id, p.user_id, p.status, p.due_at,
        r.sha256 AS receipt_sha256, r.storage_key AS receipt_storage_key
      FROM pix_payment_requests p LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=TRUE
      WHERE p.public_id=${id} AND p.user_id=${userId}`)[0]
    : backend.db.prepare(`SELECT p.id, p.public_id, p.user_id, p.status, p.due_at,
        r.sha256 AS receipt_sha256, r.storage_key AS receipt_storage_key
      FROM pix_payment_requests p LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=1
      WHERE p.public_id=? AND p.user_id=?`).get(id, userId);
  if (!row) return null;
  return {
    internalId: Number(row.id), id: row.public_id, userId: Number(row.user_id), status: row.status,
    dueAt: row.due_at, receiptSha256: row.receipt_sha256 || null,
    receiptStorageKey: row.receipt_storage_key || null,
  };
}

export async function savePixPaymentReceipt({ id, userId, organizationId = null, storageKey, originalFilename, contentType, sizeBytes, sha256 }) {
  const backend = await ensurePixSchema();
  const publicId = randomUUID();
  if (backend.type === "postgres") {
    const context = (await backend.sql`SELECT p.id AS payment_id, r.storage_key AS previous_storage_key,
        r.sha256 AS previous_sha256, r.public_id AS receipt_public_id, r.original_filename AS receipt_original_filename,
        r.content_type AS receipt_content_type, r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=TRUE
      WHERE p.public_id=${id} AND p.user_id=${userId} AND p.status IN ('pending','payment_review') AND p.due_at>NOW()
      LIMIT 1`)[0];
    if (!context) return null;
    if (context.previous_sha256 === sha256) return { receipt: serializeReceipt(context), duplicate: true, replacedStorageKey: null };
    const [, inserted] = await backend.sql.transaction((transaction) => [
      transaction`UPDATE pix_payment_receipts SET active=FALSE
        WHERE payment_id=${context.payment_id} AND active=TRUE
          AND EXISTS (SELECT 1 FROM pix_payment_requests WHERE id=${context.payment_id}
            AND user_id=${userId} AND status IN ('pending','payment_review') AND due_at>NOW())`,
      transaction`INSERT INTO pix_payment_receipts
          (public_id, payment_id, organization_id, storage_key, original_filename, content_type, size_bytes, sha256, uploaded_by_user_id, active)
        SELECT ${publicId}, id, ${organizationId}, ${storageKey}, ${originalFilename}, ${contentType}, ${sizeBytes}, ${sha256}, ${userId}, TRUE
        FROM pix_payment_requests WHERE id=${context.payment_id} AND user_id=${userId}
          AND status IN ('pending','payment_review') AND due_at>NOW() RETURNING *`,
      transaction`UPDATE pix_payment_requests SET status='payment_review', updated_at=NOW()
        WHERE id=${context.payment_id} AND user_id=${userId} AND status IN ('pending','payment_review') AND due_at>NOW()`,
    ]);
    const row = inserted[0];
    if (!row) return null;
    return { receipt: serializeReceipt(row), duplicate: false, replacedStorageKey: context.previous_storage_key || null };
  }

  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const payment = backend.db.prepare(`SELECT id FROM pix_payment_requests
      WHERE public_id=? AND user_id=? AND status IN ('pending','payment_review') AND datetime(due_at)>CURRENT_TIMESTAMP`).get(id, userId);
    if (!payment) { backend.db.exec("ROLLBACK"); return null; }
    const duplicate = backend.db.prepare("SELECT * FROM pix_payment_receipts WHERE payment_id=? AND active=1 AND sha256=?").get(payment.id, sha256);
    if (duplicate) { backend.db.exec("COMMIT"); return { receipt: serializeReceipt(duplicate), duplicate: true, replacedStorageKey: null }; }
    const previous = backend.db.prepare("SELECT storage_key FROM pix_payment_receipts WHERE payment_id=? AND active=1").get(payment.id);
    backend.db.prepare("UPDATE pix_payment_receipts SET active=0 WHERE payment_id=? AND active=1").run(payment.id);
    backend.db.prepare(`INSERT INTO pix_payment_receipts
      (public_id, payment_id, organization_id, storage_key, original_filename, content_type, size_bytes, sha256, uploaded_by_user_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(publicId, payment.id, organizationId, storageKey, originalFilename, contentType, sizeBytes, sha256, userId);
    backend.db.prepare("UPDATE pix_payment_requests SET status='payment_review', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(payment.id);
    const row = backend.db.prepare("SELECT * FROM pix_payment_receipts WHERE public_id=?").get(publicId);
    backend.db.exec("COMMIT");
    return { receipt: serializeReceipt(row), duplicate: false, replacedStorageKey: previous?.storage_key || null };
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function getActivePixReceiptForAdmin(id) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT r.*, p.user_id AS payment_user_id, p.public_id AS payment_public_id
      FROM pix_payment_receipts r JOIN pix_payment_requests p ON p.id=r.payment_id
      WHERE p.public_id=${id} AND r.active=TRUE LIMIT 1`)[0]
    : backend.db.prepare(`SELECT r.*, p.user_id AS payment_user_id, p.public_id AS payment_public_id
      FROM pix_payment_receipts r JOIN pix_payment_requests p ON p.id=r.payment_id
      WHERE p.public_id=? AND r.active=1 LIMIT 1`).get(id);
  if (!row) return null;
  return { ...serializeReceipt(row, { includeStorage: true }), paymentId: row.payment_public_id, userId: Number(row.payment_user_id) };
}

export async function reviewPixPayment({ id, approved, administratorId }) {
  const backend = await ensurePixSchema();
  if (backend.type === "postgres") {
    const rows = approved
      ? await backend.sql`WITH reviewed AS (
          UPDATE pix_payment_requests p SET status='approved', reviewed_by=${administratorId}, reviewed_at=NOW(), updated_at=NOW()
          WHERE p.public_id=${id} AND p.status='payment_review'
            AND EXISTS (SELECT 1 FROM pix_payment_receipts r WHERE r.payment_id=p.id AND r.active=TRUE)
          RETURNING p.*
        ), billing AS (
          UPDATE billing_profiles b SET payment_provider='pix', subscription_status='active',
            subscription_current_period_end=GREATEST(COALESCE(b.subscription_current_period_end, NOW()), NOW()) + INTERVAL '30 days', updated_at=NOW()
          FROM reviewed WHERE b.user_id=reviewed.user_id RETURNING b.user_id
        ) SELECT reviewed.* FROM reviewed JOIN billing ON billing.user_id=reviewed.user_id`
      : await backend.sql`WITH reviewed AS (
          UPDATE pix_payment_requests p SET status='rejected', reviewed_by=${administratorId}, reviewed_at=NOW(), updated_at=NOW()
          WHERE p.public_id=${id} AND p.status IN ('pending','payment_review') RETURNING p.*
        ), billing AS (
          UPDATE billing_profiles b SET payment_provider='pix', subscription_status='canceled',
            subscription_current_period_end=NULL, updated_at=NOW()
          FROM reviewed WHERE b.user_id=reviewed.user_id RETURNING b.user_id
        ) SELECT reviewed.* FROM reviewed JOIN billing ON billing.user_id=reviewed.user_id`;
    if (!rows.length) return null;
    return getPixPaymentById(id);
  }

  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const row = approved
      ? backend.db.prepare(`SELECT p.* FROM pix_payment_requests p WHERE p.public_id=? AND p.status='payment_review'
          AND EXISTS (SELECT 1 FROM pix_payment_receipts r WHERE r.payment_id=p.id AND r.active=1)`).get(id)
      : backend.db.prepare("SELECT * FROM pix_payment_requests WHERE public_id=? AND status IN ('pending','payment_review')").get(id);
    if (!row) { backend.db.exec("ROLLBACK"); return null; }
    const currentBilling = backend.db.prepare("SELECT subscription_current_period_end FROM billing_profiles WHERE user_id=?").get(row.user_id);
    const base = currentBilling?.subscription_current_period_end && new Date(currentBilling.subscription_current_period_end) > new Date()
      ? new Date(currentBilling.subscription_current_period_end) : new Date();
    const periodEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    backend.db.prepare("UPDATE pix_payment_requests SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(approved ? "approved" : "rejected", administratorId, row.id);
    backend.db.prepare("UPDATE billing_profiles SET payment_provider='pix', subscription_status=?, subscription_current_period_end=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
      .run(approved ? "active" : "canceled", approved ? periodEnd : null, row.user_id);
    backend.db.exec("COMMIT");
    return getPixPaymentById(id);
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function getPixPaymentById(id) {
  const backend = await ensurePixSchema();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT p.*, u.name AS user_name, u.email AS user_email,
        r.public_id AS receipt_public_id,
        r.original_filename AS receipt_original_filename, r.content_type AS receipt_content_type,
        r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p JOIN users u ON u.id=p.user_id
      LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=TRUE WHERE p.public_id=${id}`)[0]
    : backend.db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email,
        r.public_id AS receipt_public_id,
        r.original_filename AS receipt_original_filename, r.content_type AS receipt_content_type,
        r.size_bytes AS receipt_size_bytes, r.uploaded_at AS receipt_uploaded_at
      FROM pix_payment_requests p JOIN users u ON u.id=p.user_id
      LEFT JOIN pix_payment_receipts r ON r.payment_id=p.id AND r.active=1 WHERE p.public_id=?`).get(id);
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
