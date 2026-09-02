import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";

function initializeSqlite(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cash_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL,
    organization_id INTEGER, financial_account_id INTEGER NOT NULL, business_date TEXT NOT NULL,
    expected_amount REAL NOT NULL, counted_amount REAL NOT NULL, difference_amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '', actor_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_user_id) REFERENCES users(id), FOREIGN KEY(organization_id) REFERENCES organizations(id),
    FOREIGN KEY(financial_account_id) REFERENCES financial_accounts(id), FOREIGN KEY(actor_user_id) REFERENCES users(id));
    CREATE INDEX IF NOT EXISTS idx_cash_counts_organization_date ON cash_counts(organization_id,business_date,created_at DESC);`);
}

function serialize(row, enabled = true) {
  return { enabled, expected: Number(row?.expected_amount) || 0,
    counted: row?.counted_amount === null || row?.counted_amount === undefined ? null : Number(row.counted_amount),
    difference: row?.difference_amount === null || row?.difference_amount === undefined ? null : Number(row.difference_amount),
    note: row?.note || "", checkedAt: row?.created_at ? String(row.created_at) : "" };
}

export async function getCashPosition({ ownerUserId, organizationId, date }) {
  const backend = await getDatabaseBackend();
  if (backend.type === "postgres") {
    const [row] = await backend.sql`WITH account AS (
        SELECT id FROM financial_accounts WHERE owner_user_id=${ownerUserId}
          AND organization_id IS NOT DISTINCT FROM ${organizationId} AND name='Caixa principal' LIMIT 1
      ), expected AS (
        SELECT COALESCE(SUM(CASE WHEN direction='income' THEN realized_amount ELSE -realized_amount END),0) AS amount
        FROM financial_ledger_entries WHERE financial_account_id=(SELECT id FROM account)
      ), latest AS (
        SELECT counted_amount,difference_amount,note,created_at FROM cash_counts
        WHERE owner_user_id=${ownerUserId} AND organization_id IS NOT DISTINCT FROM ${organizationId} AND business_date=${date}::date
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) SELECT expected.amount AS expected_amount,latest.counted_amount,latest.difference_amount,latest.note,latest.created_at
      FROM expected LEFT JOIN latest ON TRUE`;
    return serialize(row);
  }
  initializeSqlite(backend.db);
  const account = backend.db.prepare("SELECT id FROM financial_accounts WHERE owner_user_id=? AND organization_id IS ? AND name='Caixa principal'").get(ownerUserId, organizationId);
  const expected = account ? backend.db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='income' THEN realized_amount ELSE -realized_amount END),0) AS amount FROM financial_ledger_entries WHERE financial_account_id=?").get(account.id).amount : 0;
  const latest = backend.db.prepare("SELECT counted_amount,difference_amount,note,created_at FROM cash_counts WHERE owner_user_id=? AND organization_id IS ? AND business_date=? ORDER BY id DESC LIMIT 1").get(ownerUserId, organizationId, date);
  return serialize({ expected_amount: expected, ...latest });
}

export async function saveCashCount({ ownerUserId, organizationId, actorUserId, date, counted, note }) {
  const backend = await getDatabaseBackend(); const id = randomUUID();
  if (backend.type === "postgres") {
    const accountId = randomUUID();
    await backend.sql.transaction((tx) => [
      tx`INSERT INTO financial_accounts(public_id,owner_user_id,organization_id,name,kind,currency)
        VALUES(${accountId},${ownerUserId},${organizationId},'Caixa principal','cash','BRL') ON CONFLICT(owner_user_id,name) DO NOTHING`,
      tx`INSERT INTO cash_counts(public_id,owner_user_id,organization_id,financial_account_id,business_date,expected_amount,counted_amount,difference_amount,note,actor_user_id)
        SELECT ${id},${ownerUserId},${organizationId},account.id,${date}::date,
          COALESCE(SUM(CASE WHEN entry.direction='income' THEN entry.realized_amount ELSE -entry.realized_amount END),0),${counted},
          ${counted}-COALESCE(SUM(CASE WHEN entry.direction='income' THEN entry.realized_amount ELSE -entry.realized_amount END),0),${note},${actorUserId}
        FROM financial_accounts account LEFT JOIN financial_ledger_entries entry ON entry.financial_account_id=account.id
        WHERE account.owner_user_id=${ownerUserId} AND account.organization_id IS NOT DISTINCT FROM ${organizationId} AND account.name='Caixa principal'
        GROUP BY account.id`,
    ], { isolationLevel: "Serializable" });
  } else {
    initializeSqlite(backend.db); backend.db.exec("BEGIN IMMEDIATE");
    try {
      backend.db.prepare("INSERT OR IGNORE INTO financial_accounts(public_id,owner_user_id,organization_id,name,kind,currency) VALUES(?,?,?,'Caixa principal','cash','BRL')").run(randomUUID(), ownerUserId, organizationId);
      const account = backend.db.prepare("SELECT id FROM financial_accounts WHERE owner_user_id=? AND organization_id IS ? AND name='Caixa principal'").get(ownerUserId, organizationId);
      const expected = Number(backend.db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='income' THEN realized_amount ELSE -realized_amount END),0) AS amount FROM financial_ledger_entries WHERE financial_account_id=?").get(account.id).amount) || 0;
      backend.db.prepare("INSERT INTO cash_counts(public_id,owner_user_id,organization_id,financial_account_id,business_date,expected_amount,counted_amount,difference_amount,note,actor_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id, ownerUserId, organizationId, account.id, date, expected, counted, counted - expected, note, actorUserId);
      backend.db.exec("COMMIT");
    } catch (error) { backend.db.exec("ROLLBACK"); throw error; }
  }
  return getCashPosition({ ownerUserId, organizationId, date });
}
