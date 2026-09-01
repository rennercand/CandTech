import { randomUUID } from "node:crypto";

function text(value, maxLength) {
  return String(value || "").normalize("NFKC").trim().slice(0, maxLength);
}

function publicId(value) {
  return text(value, 120) || randomUUID();
}

function simpleDate(value) {
  const date = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function fingerprint(value) {
  const normalized = text(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.public_id)) return false;
    seen.add(item.public_id);
    return true;
  });
}

function normalizeCommitments(value) {
  if (!Array.isArray(value)) return null;
  return unique(value.slice(0, 5_000).map((item) => {
    const type = item?.type === "receber" ? "receivable" : "payable";
    const expectedAmount = amount(item?.amount);
    const interestAmount = amount(item?.interestAmount);
    const penaltyAmount = amount(item?.penaltyAmount);
    const discountAmount = amount(item?.discountAmount);
    const totalAmount = Math.max(0, expectedAmount + interestAmount + penaltyAmount - discountAmount);
    const installmentCount = Math.min(60, Math.max(1, Math.trunc(Number(item?.installmentCount) || 1)));
    const installmentNumber = Math.min(
      installmentCount,
      Math.min(60, Math.max(1, Math.trunc(Number(item?.installmentNumber) || 1))),
    );
    const settled = item?.status === "recebido" || item?.status === "pago";
    const status = type === "receivable"
      ? (item?.status === "recebido" ? "received" : "pending")
      : (item?.status === "pago" ? "paid" : "pending");
    return {
      public_id: publicId(item?.id),
      kind: type,
      description: text(item?.description, 160),
      party: text(item?.party, 120),
      category: text(item?.category, 50) || "Geral",
      due_on: simpleDate(item?.dueDate),
      expected_amount: expectedAmount,
      interest_amount: interestAmount,
      penalty_amount: penaltyAmount,
      discount_amount: discountAmount,
      paid_amount: Math.min(totalAmount, item?.paidAmount === undefined && settled ? totalAmount : amount(item?.paidAmount)),
      series_public_id: text(item?.seriesId, 120) || null,
      recurrence: ["weekly", "monthly", "yearly"].includes(item?.recurrence) ? item.recurrence : "none",
      installment_number: installmentNumber,
      installment_count: installmentCount,
      status,
      settled_at: isoDate(item?.postedAt),
      origin_type: item?.sourceOrderKey ? "order" : "manual",
      origin_public_id: text(item?.sourceOrderKey, 120) || null,
    };
  }).filter((item) => item.description || item.party || item.expected_amount > 0));
}

function normalizeEntries(value) {
  if (!Array.isArray(value)) return null;
  return unique(value.slice(0, 10_000).map((item) => ({
    public_id: publicId(item?.id),
    direction: item?.type === "saida" ? "expense" : "income",
    occurred_on: simpleDate(item?.date),
    category: text(item?.category, 50) || "Geral",
    description: text(item?.description, 160),
    realized_amount: amount(item?.amount),
    origin_type: item?.sourceCommitmentId ? "commitment" : item?.sourceOrderKey ? "order" : "manual",
    origin_public_id: text(item?.sourceCommitmentId || item?.sourceOrderKey, 120) || null,
    import_batch_public_id: text(item?.importBatchId, 120) || null,
    fingerprint: fingerprint(item?.fingerprint),
    imported_at: isoDate(item?.importedAt),
  })).filter((item) => item.description || item.realized_amount > 0));
}

function serializeCommitment(row) {
  const total = Math.max(0, Number(row.expected_amount) + Number(row.interest_amount || 0) + Number(row.penalty_amount || 0) - Number(row.discount_amount || 0));
  const paid = Math.min(total, Number(row.paid_amount) || 0);
  return {
    id: row.public_id,
    type: row.kind === "receivable" ? "receber" : "pagar",
    description: row.description || "",
    party: row.party || "",
    category: row.category || "Geral",
    dueDate: row.due_on ? String(row.due_on).slice(0, 10) : "",
    amount: Number(row.expected_amount) || 0,
    status: row.status === "received" ? "recebido" : row.status === "paid" ? "pago" : paid > 0 ? "parcial" : "pendente",
    paidAmount: paid,
    interestAmount: Number(row.interest_amount) || 0,
    penaltyAmount: Number(row.penalty_amount) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    recurrence: row.recurrence || "none",
    installmentNumber: Number(row.installment_number) || 1,
    installmentCount: Number(row.installment_count) || 1,
    ...(row.series_public_id ? { seriesId: row.series_public_id } : {}),
    postedAt: row.settled_at ? String(row.settled_at) : "",
    ...(row.origin_type === "order" && row.origin_public_id ? { sourceOrderKey: row.origin_public_id } : {}),
  };
}

function serializeEntry(row) {
  return {
    id: row.public_id,
    date: row.occurred_on ? String(row.occurred_on).slice(0, 10) : "",
    category: row.category || "Geral",
    description: row.description || "",
    type: row.direction === "expense" ? "saida" : "entrada",
    amount: Number(row.realized_amount) || 0,
    ...(row.origin_type === "commitment" && row.origin_public_id ? { sourceCommitmentId: row.origin_public_id } : {}),
    ...(row.origin_type === "order" && row.origin_public_id ? { sourceOrderKey: row.origin_public_id } : {}),
    ...(row.import_batch_public_id ? { importBatchId: row.import_batch_public_id } : {}),
    ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
    ...(row.imported_at ? { importedAt: String(row.imported_at) } : {}),
  };
}

export function initializeSqliteFinance(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL,
      organization_id INTEGER,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'cash' CHECK(kind IN ('cash', 'bank', 'other')),
      currency TEXT NOT NULL DEFAULT 'BRL',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_user_id, name),
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_financial_accounts_organization
      ON financial_accounts(organization_id, active, name);
    CREATE TABLE IF NOT EXISTS financial_commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      organization_id INTEGER,
      kind TEXT NOT NULL CHECK(kind IN ('payable', 'receivable')),
      description TEXT NOT NULL DEFAULT '',
      party TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Geral',
      due_on TEXT,
      expected_amount REAL NOT NULL DEFAULT 0 CHECK(expected_amount >= 0),
      interest_amount REAL NOT NULL DEFAULT 0 CHECK(interest_amount >= 0),
      penalty_amount REAL NOT NULL DEFAULT 0 CHECK(penalty_amount >= 0),
      discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
      series_public_id TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','weekly','monthly','yearly')),
      installment_number INTEGER NOT NULL DEFAULT 1 CHECK(installment_number BETWEEN 1 AND 60),
      installment_count INTEGER NOT NULL DEFAULT 1 CHECK(installment_count BETWEEN 1 AND 60),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'received', 'cancelled')),
      settled_at TEXT,
      origin_type TEXT NOT NULL DEFAULT 'manual',
      origin_public_id TEXT,
      import_batch_public_id TEXT,
      fingerprint TEXT,
      imported_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_user_id, public_id),
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_financial_commitments_organization_status_due
      ON financial_commitments(organization_id, status, due_on);
    CREATE TABLE IF NOT EXISTS financial_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      organization_id INTEGER,
      financial_account_id INTEGER NOT NULL,
      commitment_id INTEGER,
      direction TEXT NOT NULL CHECK(direction IN ('income', 'expense')),
      occurred_on TEXT,
      category TEXT NOT NULL DEFAULT 'Geral',
      description TEXT NOT NULL DEFAULT '',
      realized_amount REAL NOT NULL DEFAULT 0 CHECK(realized_amount >= 0),
      origin_type TEXT NOT NULL DEFAULT 'manual',
      origin_public_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_user_id, public_id),
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY(financial_account_id) REFERENCES financial_accounts(id),
      FOREIGN KEY(commitment_id) REFERENCES financial_commitments(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_financial_ledger_organization_date
      ON financial_ledger_entries(organization_id, occurred_on, id);
  `);
  const ledgerColumns = db.prepare("PRAGMA table_info(financial_ledger_entries)").all();
  if (!ledgerColumns.some((column) => column.name === "import_batch_public_id")) db.exec("ALTER TABLE financial_ledger_entries ADD COLUMN import_batch_public_id TEXT");
  if (!ledgerColumns.some((column) => column.name === "fingerprint")) db.exec("ALTER TABLE financial_ledger_entries ADD COLUMN fingerprint TEXT");
  if (!ledgerColumns.some((column) => column.name === "imported_at")) db.exec("ALTER TABLE financial_ledger_entries ADD COLUMN imported_at TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_financial_ledger_import_batch
      ON financial_ledger_entries(owner_user_id, organization_id, import_batch_public_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_ledger_import_fingerprint
      ON financial_ledger_entries(owner_user_id, IFNULL(organization_id, 0), fingerprint)
      WHERE fingerprint IS NOT NULL;
  `);
  const commitmentColumns = db.prepare("PRAGMA table_info(financial_commitments)").all();
  for (const [name, definition] of [
    ["interest_amount", "REAL NOT NULL DEFAULT 0"], ["penalty_amount", "REAL NOT NULL DEFAULT 0"],
    ["discount_amount", "REAL NOT NULL DEFAULT 0"], ["paid_amount", "REAL NOT NULL DEFAULT 0"],
    ["series_public_id", "TEXT"], ["recurrence", "TEXT NOT NULL DEFAULT 'none'"],
    ["installment_number", "INTEGER NOT NULL DEFAULT 1"], ["installment_count", "INTEGER NOT NULL DEFAULT 1"],
  ]) if (!commitmentColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE financial_commitments ADD COLUMN ${name} ${definition}`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_financial_commitments_series ON financial_commitments(owner_user_id, organization_id, series_public_id, installment_number)");
  db.exec("UPDATE financial_commitments SET paid_amount=expected_amount WHERE paid_amount=0 AND status IN ('paid','received')");
  const columns = db.prepare("PRAGMA table_info(workspaces)").all();
  if (!columns.some((column) => column.name === "finance_relational_at")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN finance_relational_at TEXT");
  }
}

export async function listFinancialCommitments(backend, ownerUserId, organizationId) {
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT public_id, kind, description, party, category, due_on, expected_amount,
             interest_amount, penalty_amount, discount_amount, paid_amount,
             series_public_id, recurrence, installment_number, installment_count,
             status, settled_at, origin_type, origin_public_id
      FROM financial_commitments
      WHERE owner_user_id = ${ownerUserId} AND organization_id IS NOT DISTINCT FROM ${organizationId}
      ORDER BY created_at, id
    `;
    return rows.map(serializeCommitment);
  }
  return backend.db.prepare(`
    SELECT public_id, kind, description, party, category, due_on, expected_amount,
           interest_amount, penalty_amount, discount_amount, paid_amount,
           series_public_id, recurrence, installment_number, installment_count,
           status, settled_at, origin_type, origin_public_id
    FROM financial_commitments
    WHERE owner_user_id = ? AND organization_id IS ?
    ORDER BY created_at, id
  `).all(ownerUserId, organizationId).map(serializeCommitment);
}

export async function listFinancialLedgerEntries(backend, ownerUserId, organizationId) {
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT entry.public_id, entry.direction, entry.occurred_on, entry.category,
             entry.description, entry.realized_amount, entry.origin_type,
             COALESCE(commitment.public_id, entry.origin_public_id) AS origin_public_id,
             entry.import_batch_public_id, entry.fingerprint, entry.imported_at
      FROM financial_ledger_entries entry
      LEFT JOIN financial_commitments commitment ON commitment.id = entry.commitment_id
      WHERE entry.owner_user_id = ${ownerUserId}
        AND entry.organization_id IS NOT DISTINCT FROM ${organizationId}
      ORDER BY entry.occurred_on, entry.created_at, entry.id
    `;
    return rows.map(serializeEntry);
  }
  return backend.db.prepare(`
    SELECT entry.public_id, entry.direction, entry.occurred_on, entry.category,
           entry.description, entry.realized_amount, entry.origin_type,
           COALESCE(commitment.public_id, entry.origin_public_id) AS origin_public_id,
           entry.import_batch_public_id, entry.fingerprint, entry.imported_at
    FROM financial_ledger_entries entry
    LEFT JOIN financial_commitments commitment ON commitment.id = entry.commitment_id
    WHERE entry.owner_user_id = ? AND entry.organization_id IS ?
    ORDER BY entry.occurred_on, entry.created_at, entry.id
  `).all(ownerUserId, organizationId).map(serializeEntry);
}

export async function hydrateWorkspaceFinance(backend, workspace) {
  if (!workspace) return null;
  const migrated = Boolean(workspace.finance_relational_at);
  const { finance_relational_at: _marker, ...cleanWorkspace } = workspace;
  if (!migrated) return cleanWorkspace;
  const [financialAccounts, cashEntries] = await Promise.all([
    listFinancialCommitments(backend, workspace.user_id, workspace.organization_id),
    listFinancialLedgerEntries(backend, workspace.user_id, workspace.organization_id),
  ]);
  return { ...cleanWorkspace, payload: { ...cleanWorkspace.payload, financialAccounts, cashEntries } };
}

async function syncPostgres(backend, { ownerUserId, organizationId, commitments, entries }) {
  const accountId = randomUUID();
  const queries = [backend.sql`
    INSERT INTO financial_accounts (public_id, owner_user_id, organization_id, name, kind, currency)
    VALUES (${accountId}, ${ownerUserId}, ${organizationId}, 'Caixa principal', 'cash', 'BRL')
    ON CONFLICT (owner_user_id, name) DO UPDATE SET updated_at = financial_accounts.updated_at
    WHERE financial_accounts.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
  `];
  if (commitments) {
    const serialized = JSON.stringify(commitments);
    queries.push(backend.sql`
      INSERT INTO financial_commitments (
        public_id, owner_user_id, organization_id, kind, description, party, category,
        due_on, expected_amount, interest_amount, penalty_amount, discount_amount, paid_amount,
        series_public_id, recurrence, installment_number, installment_count,
        status, settled_at, origin_type, origin_public_id
      )
      SELECT input.public_id, ${ownerUserId}, ${organizationId}, input.kind, input.description,
             input.party, input.category, input.due_on::date, input.expected_amount,
             input.interest_amount, input.penalty_amount, input.discount_amount, input.paid_amount,
             input.series_public_id, input.recurrence, input.installment_number, input.installment_count,
             input.status, input.settled_at::timestamptz, input.origin_type, input.origin_public_id
      FROM jsonb_to_recordset(${serialized}::jsonb) AS input(
        public_id text, kind text, description text, party text, category text, due_on text,
        expected_amount numeric, interest_amount numeric, penalty_amount numeric, discount_amount numeric,
        paid_amount numeric, series_public_id text, recurrence text, installment_number integer, installment_count integer,
        status text, settled_at text, origin_type text, origin_public_id text
      )
      ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
        kind = EXCLUDED.kind, description = EXCLUDED.description, party = EXCLUDED.party,
        category = EXCLUDED.category, due_on = EXCLUDED.due_on,
        expected_amount = EXCLUDED.expected_amount, interest_amount = EXCLUDED.interest_amount,
        penalty_amount = EXCLUDED.penalty_amount, discount_amount = EXCLUDED.discount_amount,
        paid_amount = EXCLUDED.paid_amount, series_public_id = EXCLUDED.series_public_id,
        recurrence = EXCLUDED.recurrence, installment_number = EXCLUDED.installment_number,
        installment_count = EXCLUDED.installment_count, status = EXCLUDED.status,
        settled_at = EXCLUDED.settled_at, origin_type = EXCLUDED.origin_type,
        origin_public_id = EXCLUDED.origin_public_id, updated_at = NOW()
      WHERE financial_commitments.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
    `);
  }
  if (entries) {
    const serialized = JSON.stringify(entries);
    queries.push(backend.sql`
      INSERT INTO financial_ledger_entries (
        public_id, owner_user_id, organization_id, financial_account_id, commitment_id,
        direction, occurred_on, category, description, realized_amount, origin_type, origin_public_id,
        import_batch_public_id, fingerprint, imported_at
      )
      SELECT input.public_id, ${ownerUserId}, ${organizationId}, account.id, commitment.id,
             input.direction, input.occurred_on::date, input.category, input.description,
             input.realized_amount, input.origin_type, input.origin_public_id,
             input.import_batch_public_id, input.fingerprint, input.imported_at::timestamptz
      FROM jsonb_to_recordset(${serialized}::jsonb) AS input(
        public_id text, direction text, occurred_on text, category text, description text,
        realized_amount numeric, origin_type text, origin_public_id text,
        import_batch_public_id text, fingerprint text, imported_at text
      )
      JOIN financial_accounts account
        ON account.owner_user_id = ${ownerUserId}
       AND account.organization_id IS NOT DISTINCT FROM ${organizationId}
       AND account.name = 'Caixa principal'
      LEFT JOIN financial_commitments commitment
        ON input.origin_type = 'commitment'
       AND commitment.owner_user_id = ${ownerUserId}
       AND commitment.organization_id IS NOT DISTINCT FROM ${organizationId}
       AND commitment.public_id = input.origin_public_id
      ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
        financial_account_id = EXCLUDED.financial_account_id,
        commitment_id = EXCLUDED.commitment_id,
        direction = EXCLUDED.direction, occurred_on = EXCLUDED.occurred_on,
        category = EXCLUDED.category, description = EXCLUDED.description,
        realized_amount = EXCLUDED.realized_amount, origin_type = EXCLUDED.origin_type,
        origin_public_id = EXCLUDED.origin_public_id,
        import_batch_public_id = EXCLUDED.import_batch_public_id,
        fingerprint = EXCLUDED.fingerprint, imported_at = EXCLUDED.imported_at,
        updated_at = NOW()
      WHERE financial_ledger_entries.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
    `);
    queries.push(backend.sql`
      DELETE FROM financial_ledger_entries entry
      WHERE entry.owner_user_id = ${ownerUserId}
        AND entry.organization_id IS NOT DISTINCT FROM ${organizationId}
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(${serialized}::jsonb) AS input(public_id text)
          WHERE input.public_id = entry.public_id
        )
    `);
  }
  if (commitments) {
    const serialized = JSON.stringify(commitments);
    queries.push(backend.sql`
      DELETE FROM financial_commitments commitment
      WHERE commitment.owner_user_id = ${ownerUserId}
        AND commitment.organization_id IS NOT DISTINCT FROM ${organizationId}
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(${serialized}::jsonb) AS input(public_id text)
          WHERE input.public_id = commitment.public_id
        )
    `);
  }
  queries.push(backend.sql`
    UPDATE workspaces SET finance_relational_at = COALESCE(finance_relational_at, NOW())
    WHERE user_id = ${ownerUserId} AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `);
  await backend.sql.transaction(queries);
}

function syncSqlite(backend, { ownerUserId, organizationId, commitments, entries }) {
  const { db } = backend;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO financial_accounts (public_id, owner_user_id, organization_id, name, kind, currency)
      VALUES (?, ?, ?, 'Caixa principal', 'cash', 'BRL')
      ON CONFLICT(owner_user_id, name) DO UPDATE SET updated_at = financial_accounts.updated_at
      WHERE financial_accounts.organization_id IS excluded.organization_id
    `).run(randomUUID(), ownerUserId, organizationId);
    const account = db.prepare("SELECT id FROM financial_accounts WHERE owner_user_id = ? AND organization_id IS ? AND name = 'Caixa principal'").get(ownerUserId, organizationId);
    if (commitments) {
      const upsert = db.prepare(`
        INSERT INTO financial_commitments (
          public_id, owner_user_id, organization_id, kind, description, party, category,
          due_on, expected_amount, interest_amount, penalty_amount, discount_amount, paid_amount,
          series_public_id, recurrence, installment_number, installment_count,
          status, settled_at, origin_type, origin_public_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, public_id) DO UPDATE SET
          kind=excluded.kind, description=excluded.description, party=excluded.party,
          category=excluded.category, due_on=excluded.due_on, expected_amount=excluded.expected_amount,
          interest_amount=excluded.interest_amount, penalty_amount=excluded.penalty_amount,
          discount_amount=excluded.discount_amount, paid_amount=excluded.paid_amount,
          series_public_id=excluded.series_public_id, recurrence=excluded.recurrence,
          installment_number=excluded.installment_number, installment_count=excluded.installment_count,
          status=excluded.status, settled_at=excluded.settled_at, origin_type=excluded.origin_type,
          origin_public_id=excluded.origin_public_id, updated_at=CURRENT_TIMESTAMP
        WHERE financial_commitments.organization_id IS excluded.organization_id
      `);
      for (const item of commitments) upsert.run(item.public_id, ownerUserId, organizationId,
        item.kind, item.description, item.party, item.category, item.due_on, item.expected_amount,
        item.interest_amount, item.penalty_amount, item.discount_amount, item.paid_amount,
        item.series_public_id, item.recurrence, item.installment_number, item.installment_count,
        item.status, item.settled_at, item.origin_type, item.origin_public_id);
    }
    if (entries) {
      const findCommitment = db.prepare("SELECT id FROM financial_commitments WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      const upsert = db.prepare(`
        INSERT INTO financial_ledger_entries (
          public_id, owner_user_id, organization_id, financial_account_id, commitment_id,
          direction, occurred_on, category, description, realized_amount, origin_type, origin_public_id,
          import_batch_public_id, fingerprint, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, public_id) DO UPDATE SET
          financial_account_id=excluded.financial_account_id, commitment_id=excluded.commitment_id,
          direction=excluded.direction, occurred_on=excluded.occurred_on, category=excluded.category,
          description=excluded.description, realized_amount=excluded.realized_amount,
          origin_type=excluded.origin_type, origin_public_id=excluded.origin_public_id,
          import_batch_public_id=excluded.import_batch_public_id,
          fingerprint=excluded.fingerprint, imported_at=excluded.imported_at,
          updated_at=CURRENT_TIMESTAMP
        WHERE financial_ledger_entries.organization_id IS excluded.organization_id
      `);
      for (const item of entries) {
        const commitmentId = item.origin_type === "commitment"
          ? findCommitment.get(ownerUserId, organizationId, item.origin_public_id)?.id || null
          : null;
        upsert.run(item.public_id, ownerUserId, organizationId, account.id, commitmentId,
          item.direction, item.occurred_on, item.category, item.description, item.realized_amount,
          item.origin_type, item.origin_public_id, item.import_batch_public_id, item.fingerprint, item.imported_at);
      }
      const allowed = new Set(entries.map((item) => item.public_id));
      const current = db.prepare("SELECT public_id FROM financial_ledger_entries WHERE owner_user_id = ? AND organization_id IS ?").all(ownerUserId, organizationId);
      const remove = db.prepare("DELETE FROM financial_ledger_entries WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      for (const row of current) if (!allowed.has(row.public_id)) remove.run(ownerUserId, organizationId, row.public_id);
    }
    if (commitments) {
      const allowed = new Set(commitments.map((item) => item.public_id));
      const current = db.prepare("SELECT public_id FROM financial_commitments WHERE owner_user_id = ? AND organization_id IS ?").all(ownerUserId, organizationId);
      const remove = db.prepare("DELETE FROM financial_commitments WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      for (const row of current) if (!allowed.has(row.public_id)) remove.run(ownerUserId, organizationId, row.public_id);
    }
    db.prepare("UPDATE workspaces SET finance_relational_at = COALESCE(finance_relational_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND organization_id IS ?").run(ownerUserId, organizationId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function syncWorkspaceFinance(backend, { ownerUserId, organizationId, payload }) {
  const commitments = normalizeCommitments(payload?.financialAccounts);
  const entries = normalizeEntries(payload?.cashEntries);
  if (!commitments && !entries) return;
  if (backend.type === "postgres") {
    await syncPostgres(backend, { ownerUserId, organizationId, commitments, entries });
    return;
  }
  syncSqlite(backend, { ownerUserId, organizationId, commitments, entries });
}
