// Esta camada isola o restante do aplicativo dos detalhes do banco de dados.
// Em produção usamos Postgres/Neon, que persiste dados entre execuções da Vercel.
// Sem DATABASE_URL (desenvolvimento local), usamos o arquivo SQLite existente.

let backendPromise;

async function createPostgresBackend() {
  // O import é tardio para o build não falhar antes de DATABASE_URL ser configurada.
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);

  // Garante que uma instalação nova tenha as tabelas necessárias.
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS histories (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      calculation_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      archived_revision BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      rate_key TEXT NOT NULL,
      window_start BIGINT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (rate_key, window_start)
    )
  `;

  return { type: "postgres", sql };
}

async function createSqliteBackend() {
  // SQLite é útil localmente, mas o arquivo não deve ser usado como banco na Vercel.
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(process.cwd(), "data", "finsight.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);

  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS histories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      calculation_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      user_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      archived_revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      rate_key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (rate_key, window_start)
    );
  `);

  return { type: "sqlite", db };
}

async function getBackend() {
  // A Promise é reutilizada para não abrir conexões nem recriar tabelas a cada consulta.
  if (!backendPromise) {
    backendPromise = process.env.DATABASE_URL
      ? createPostgresBackend()
      : createSqliteBackend();
  }
  return backendPromise;
}

export async function createUser({ name, email, passwordHash }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (${name}, ${email}, ${passwordHash})
      RETURNING id, name, email
    `;
    return { ...rows[0], id: Number(rows[0].id) };
  }

  const result = backend.db
    .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
    .run(name, email, passwordHash);
  return { id: Number(result.lastInsertRowid), name, email };
}

export async function findUserByEmail(email) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT id, name, email, password_hash FROM users WHERE email = ${email}
    `;
    return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
  }
  return backend.db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
}

function serializeWorkspace(row) {
  if (!row) return null;
  return {
    ...row,
    user_id: Number(row.user_id),
    revision: Number(row.revision),
    archived_revision: Number(row.archived_revision),
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  };
}

export async function getWorkspace(userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT user_id, payload, revision, archived_revision, updated_at
      FROM workspaces WHERE user_id = ${userId}
    `;
    return serializeWorkspace(rows[0]);
  }
  return serializeWorkspace(
    backend.db
      .prepare("SELECT user_id, payload, revision, archived_revision, updated_at FROM workspaces WHERE user_id = ?")
      .get(userId),
  );
}

export async function saveWorkspace({ userId, payload, markSaved = false }) {
  const backend = await getBackend();
  const serialized = JSON.stringify(payload);

  if (backend.type === "postgres") {
    // Só cria uma nova revisão quando o conteúdo realmente mudou.
    const rows = await backend.sql`
      INSERT INTO workspaces (user_id, payload, revision, archived_revision)
      VALUES (${userId}, ${serialized}::jsonb, 1, ${markSaved ? 1 : 0})
      ON CONFLICT (user_id) DO UPDATE SET
        payload = EXCLUDED.payload,
        revision = CASE
          WHEN workspaces.payload IS DISTINCT FROM EXCLUDED.payload THEN workspaces.revision + 1
          ELSE workspaces.revision
        END,
        archived_revision = CASE
          WHEN ${markSaved} THEN CASE
            WHEN workspaces.payload IS DISTINCT FROM EXCLUDED.payload THEN workspaces.revision + 1
            ELSE workspaces.revision
          END
          ELSE workspaces.archived_revision
        END,
        updated_at = CASE
          WHEN workspaces.payload IS DISTINCT FROM EXCLUDED.payload THEN NOW()
          ELSE workspaces.updated_at
        END
      RETURNING user_id, payload, revision, archived_revision, updated_at
    `;
    return serializeWorkspace(rows[0]);
  }

  const current = await getWorkspace(userId);
  const changed = !current || JSON.stringify(current.payload) !== serialized;
  if (!current) {
    backend.db
      .prepare("INSERT INTO workspaces (user_id, payload, revision, archived_revision) VALUES (?, ?, 1, ?)")
      .run(userId, serialized, markSaved ? 1 : 0);
  } else if (changed) {
    const nextRevision = current.revision + 1;
    backend.db
      .prepare("UPDATE workspaces SET payload = ?, revision = ?, archived_revision = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
      .run(serialized, nextRevision, markSaved ? nextRevision : current.archived_revision, userId);
  } else if (markSaved) {
    backend.db
      .prepare("UPDATE workspaces SET archived_revision = revision WHERE user_id = ?")
      .run(userId);
  }
  return getWorkspace(userId);
}

export async function archiveWorkspace({ userId, title }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    // A atualização reivindica a revisão uma única vez, evitando históricos duplicados.
    const rows = await backend.sql`
      WITH candidate AS (
        UPDATE workspaces
        SET archived_revision = revision
        WHERE user_id = ${userId} AND revision > archived_revision
        RETURNING payload
      )
      INSERT INTO histories (user_id, title, calculation_type, payload)
      SELECT ${userId}, ${title}, 'rascunho-automatico', payload FROM candidate
      RETURNING id, title, calculation_type, payload, created_at
    `;
    return rows[0] || null;
  }

  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const current = await getWorkspace(userId);
    if (!current || current.revision <= current.archived_revision) {
      backend.db.exec("COMMIT");
      return null;
    }
    backend.db
      .prepare("UPDATE workspaces SET archived_revision = revision WHERE user_id = ?")
      .run(userId);
    const result = backend.db
      .prepare("INSERT INTO histories (user_id, title, calculation_type, payload) VALUES (?, ?, 'rascunho-automatico', ?)")
      .run(userId, title, JSON.stringify(current.payload));
    backend.db.exec("COMMIT");
    return findHistoryById(Number(result.lastInsertRowid), userId);
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function listHistories(userId, calculationType) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    return calculationType
      ? backend.sql`SELECT id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ${userId} AND calculation_type = ${calculationType} ORDER BY id DESC`
      : backend.sql`SELECT id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ${userId} ORDER BY id DESC`;
  }

  const statement = calculationType
    ? backend.db.prepare("SELECT id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ? AND calculation_type = ? ORDER BY id DESC")
    : backend.db.prepare("SELECT id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ? ORDER BY id DESC");
  return calculationType ? statement.all(userId, calculationType) : statement.all(userId);
}

export async function createHistory({ userId, title, calculationType, payload }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO histories (user_id, title, calculation_type, payload)
      VALUES (${userId}, ${title}, ${calculationType}, ${JSON.stringify(payload)}::jsonb)
      RETURNING id, title, calculation_type, payload, created_at
    `;
    return rows[0];
  }

  const result = backend.db
    .prepare("INSERT INTO histories (user_id, title, calculation_type, payload) VALUES (?, ?, ?, ?)")
    .run(userId, title, calculationType, JSON.stringify(payload));
  return findHistoryById(Number(result.lastInsertRowid), userId);
}

export async function findHistoryById(id, userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT id, title, calculation_type, payload, created_at
      FROM histories WHERE id = ${id} AND user_id = ${userId}
    `;
    return rows[0] || null;
  }
  return backend.db
    .prepare("SELECT id, title, calculation_type, payload, created_at FROM histories WHERE id = ? AND user_id = ?")
    .get(id, userId) || null;
}

export async function deleteHistory(id, userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      DELETE FROM histories WHERE id = ${id} AND user_id = ${userId} RETURNING id
    `;
    return rows.length > 0;
  }
  return backend.db.prepare("DELETE FROM histories WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export async function consumeRateLimit({ key, limit, windowMs }) {
  const backend = await getBackend();
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;

  if (backend.type === "postgres") {
    // O UPSERT é atômico: duas instâncias da Vercel não perdem contagens concorrentes.
    const rows = await backend.sql`
      INSERT INTO rate_limits (rate_key, window_start, request_count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (rate_key, window_start) DO UPDATE
      SET request_count = rate_limits.request_count + 1
      RETURNING request_count
    `;
    const count = Number(rows[0].request_count);
    // Limpeza probabilística impede crescimento ilimitado sem adicionar custo a toda requisição.
    if (Math.random() < 0.01) {
      await backend.sql`DELETE FROM rate_limits WHERE window_start < ${Date.now() - 86_400_000}`;
    }
    return { allowed: count <= limit, count, limit, resetAt: windowStart + windowMs };
  }

  // O SQLite é usado somente no desenvolvimento local e aplica a mesma regra.
  backend.db
    .prepare(`
      INSERT INTO rate_limits (rate_key, window_start, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(rate_key, window_start) DO UPDATE
      SET request_count = request_count + 1
    `)
    .run(key, windowStart);
  const row = backend.db
    .prepare("SELECT request_count FROM rate_limits WHERE rate_key = ? AND window_start = ?")
    .get(key, windowStart);
  const count = Number(row.request_count);
  if (Math.random() < 0.01) {
    backend.db
      .prepare("DELETE FROM rate_limits WHERE window_start < ?")
      .run(Date.now() - 86_400_000);
  }
  return { allowed: count <= limit, count, limit, resetAt: windowStart + windowMs };
}

export function isUniqueConstraintError(error) {
  // Postgres usa o código 23505; SQLite inclui UNIQUE na mensagem.
  return error?.code === "23505" || String(error?.message || "").includes("UNIQUE");
}

export function serializeHistory(row) {
  // Postgres já entrega JSON; SQLite devolve o payload como texto.
  return { ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload };
}
