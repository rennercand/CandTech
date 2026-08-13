import { ALL_TEAM_PERMISSIONS, normalizePermissions, normalizeRole } from "./team-permissions.js";
import { hasMeaningfulWorkspaceContent } from "./workspace-content.js";
import { randomUUID } from "node:crypto";

// Esta camada isola o restante do aplicativo dos detalhes do banco de dados.
// Em produção usamos Postgres/Neon, que persiste dados entre execuções da Vercel.
// Sem DATABASE_URL (desenvolvimento local), usamos o arquivo SQLite existente.

let backendPromise;

const ARCHIVED_DUPLICATE_DOMAIN = "invalid.candtech.local";
const ARCHIVED_DUPLICATE_PASSWORD = "!archived-duplicate-account!";

async function repairPostgresDuplicateUserEmails(sql) {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'`;
  const duplicateGroups = await sql`
    SELECT LOWER(BTRIM(email)) AS normalized_email
    FROM users
    WHERE account_status = 'active'
    GROUP BY LOWER(BTRIM(email))
    HAVING COUNT(*) > 1
  `;
  let archived = 0;
  for (const group of duplicateGroups) {
    // Mantém a identidade com maior evidência de uso. Nenhum dado comercial é
    // movido ou apagado automaticamente; contas excedentes ficam arquivadas.
    const candidates = await sql`
      SELECT u.id
      FROM users u
      WHERE u.account_status = 'active' AND LOWER(BTRIM(u.email)) = ${group.normalized_email}
      ORDER BY
        EXISTS (
          SELECT 1 FROM billing_profiles b
          WHERE b.user_id = u.id AND b.subscription_status IN ('active', 'trialing')
        ) DESC,
        (u.email_verified_at IS NOT NULL) DESC,
        EXISTS (SELECT 1 FROM organizations o WHERE o.owner_user_id = u.id) DESC,
        EXISTS (SELECT 1 FROM workspaces w WHERE w.user_id = u.id) DESC,
        (SELECT COUNT(*) FROM histories h WHERE h.user_id = u.id) DESC,
        u.created_at ASC,
        u.id ASC
    `;
    const keeperId = candidates[0]?.id;
    if (!keeperId) continue;
    for (const candidate of candidates.slice(1)) {
      const archivedEmail = `archived-duplicate-${candidate.id}@${ARCHIVED_DUPLICATE_DOMAIN}`;
      await sql`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = ${candidate.id}`;
      await sql`UPDATE auth_action_tokens SET used_at = COALESCE(used_at, NOW()) WHERE user_id = ${candidate.id}`;
      await sql`
        UPDATE users SET
          email = ${archivedEmail},
          password_hash = ${ARCHIVED_DUPLICATE_PASSWORD},
          account_status = 'archived_duplicate'
        WHERE id = ${candidate.id} AND account_status = 'active'
      `;
      archived += 1;
    }
    await sql`UPDATE users SET email = ${group.normalized_email} WHERE id = ${keeperId}`;
  }
  await sql`UPDATE users SET email = LOWER(BTRIM(email)) WHERE account_status = 'active'`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users ((LOWER(BTRIM(email))))`;
  if (archived > 0) {
    await sql`
      INSERT INTO audit_events (user_id, action, metadata)
      VALUES (NULL, 'account.duplicate_archived', jsonb_build_object('count', ${archived}, 'strategy', 'preserve_data'))
    `;
  }
  return archived;
}

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
      account_type TEXT NOT NULL DEFAULT 'person',
      email_verified_at TIMESTAMPTZ,
      email_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
      legal_accepted_at TIMESTAMPTZ,
      terms_version TEXT,
      privacy_version TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'person'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`
    CREATE TABLE IF NOT EXISTS histories (
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT UNIQUE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      calculation_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE histories ADD COLUMN IF NOT EXISTS public_id TEXT`;
  const historiesWithoutPublicId = await sql`SELECT id FROM histories WHERE public_id IS NULL`;
  for (const row of historiesWithoutPublicId) {
    await sql`UPDATE histories SET public_id = ${randomUUID()} WHERE id = ${row.id} AND public_id IS NULL`;
  }
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_histories_public_id ON histories (public_id)`;
  await sql`
    CREATE OR REPLACE FUNCTION enforce_user_document_limit()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.calculation_type <> 'rascunho-automatico' THEN
        PERFORM pg_advisory_xact_lock(NEW.user_id);
        IF (SELECT COUNT(*) FROM histories WHERE user_id = NEW.user_id AND calculation_type <> 'rascunho-automatico') >= 10 THEN
          RAISE EXCEPTION 'document_limit_reached' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'histories_document_limit') THEN
        CREATE TRIGGER histories_document_limit
        BEFORE INSERT ON histories
        FOR EACH ROW EXECUTE FUNCTION enforce_user_document_limit();
      END IF;
    END $$
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
  await sql`
    CREATE TABLE IF NOT EXISTS google_drive_connections (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_refresh_token TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS auth_action_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_active ON auth_action_tokens (user_id, purpose, expires_at) WHERE used_at IS NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS billing_profiles (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      account_type TEXT NOT NULL DEFAULT 'person',
      legal_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      address_number TEXT NOT NULL DEFAULT '',
      complement TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      subscription_status TEXT NOT NULL DEFAULT 'not_subscriber',
      payment_provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      provider_price_id TEXT,
      subscription_current_period_end TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT`;
  await sql`ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS provider_price_id TEXT`;
  await sql`ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ`;
  await sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_events_user_created ON audit_events (user_id, created_at DESC)`;
  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_monitoring_events_status_seen ON monitoring_events (status, last_seen_at DESC)`;
  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created ON support_tickets (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated ON support_tickets (status, updated_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS organization_jobs (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager', 'attendant')),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_jobs_name ON organization_jobs (organization_id, LOWER(name))`;
  await sql`
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'attendant')),
      job_title TEXT NOT NULL DEFAULT '',
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, user_id)
    )
  `;
  await sql`ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organization_members_org ON organization_members (organization_id, status)`;
  await sql`
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager', 'attendant')),
      job_title TEXT NOT NULL DEFAULT '',
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE organization_invitations ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE INDEX IF NOT EXISTS idx_organization_invites_active ON organization_invitations (organization_id, email, expires_at)`;

  // Executa depois de todas as tabelas relacionadas existirem. A rotina é
  // idempotente e o índice funcional impede que a duplicidade volte a ocorrer.
  await repairPostgresDuplicateUserEmails(sql);

  return { type: "postgres", sql };
}

async function createSqliteBackend() {
  // SQLite é útil localmente, mas o arquivo não deve ser usado como banco na Vercel.
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  // Testes e ferramentas locais podem apontar para um arquivo isolado sem tocar nos dados reais.
  const databasePath = process.env.SQLITE_DATABASE_PATH
    ? path.resolve(process.env.SQLITE_DATABASE_PATH)
    : path.join(process.cwd(), "data", "finsight.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);

  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'person',
      email_verified_at TEXT,
      email_verification_required INTEGER NOT NULL DEFAULT 0,
      legal_accepted_at TEXT,
      terms_version TEXT,
      privacy_version TEXT,
      account_status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS histories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT UNIQUE,
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
    CREATE TABLE IF NOT EXISTS google_drive_connections (
      user_id INTEGER PRIMARY KEY,
      encrypted_refresh_token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
      ON auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS auth_action_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_active
      ON auth_action_tokens(user_id, purpose, expires_at) WHERE used_at IS NULL;
    CREATE TABLE IF NOT EXISTS billing_profiles (
      user_id INTEGER PRIMARY KEY,
      account_type TEXT NOT NULL DEFAULT 'person',
      legal_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '', address_number TEXT NOT NULL DEFAULT '',
      complement TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '',
      subscription_status TEXT NOT NULL DEFAULT 'not_subscriber',
      payment_provider TEXT, provider_customer_id TEXT,
      provider_subscription_id TEXT, provider_price_id TEXT,
      subscription_current_period_end TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_user_created ON audit_events(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS monitoring_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      fingerprint TEXT NOT NULL UNIQUE,
      level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'info')),
      source TEXT NOT NULL, code TEXT NOT NULL, summary TEXT NOT NULL,
      route TEXT NOT NULL DEFAULT '', environment TEXT NOT NULL DEFAULT '',
      occurrences INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
      details TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_monitoring_events_status_seen ON monitoring_events(status, last_seen_at DESC);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      organization_id INTEGER,
      subject TEXT NOT NULL, message TEXT NOT NULL,
      preferred_channel TEXT NOT NULL DEFAULT 'site' CHECK (preferred_channel IN ('site', 'email', 'phone')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
      admin_reply TEXT NOT NULL DEFAULT '', replied_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created ON support_tickets(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated ON support_tickets(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS organization_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK (role IN ('manager', 'attendant')),
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, name),
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'attendant')),
      job_title TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, user_id),
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_organization_members_org
      ON organization_members(organization_id, status);
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK (role IN ('manager', 'attendant')),
      job_title TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '[]',
      token_hash TEXT NOT NULL UNIQUE,
      invited_by INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY(invited_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_organization_invites_active
      ON organization_invitations(organization_id, email, expires_at);
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "account_type")) {
    db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'person'");
  }
  if (!userColumns.some((column) => column.name === "email_verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
  }
  if (!userColumns.some((column) => column.name === "email_verification_required")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verification_required INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "legal_accepted_at")) {
    db.exec("ALTER TABLE users ADD COLUMN legal_accepted_at TEXT");
  }
  if (!userColumns.some((column) => column.name === "terms_version")) {
    db.exec("ALTER TABLE users ADD COLUMN terms_version TEXT");
  }
  if (!userColumns.some((column) => column.name === "privacy_version")) {
    db.exec("ALTER TABLE users ADD COLUMN privacy_version TEXT");
  }
  if (!userColumns.some((column) => column.name === "account_status")) {
    db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'");
  }
  // Bancos locais antigos também podem conter espaços nas pontas do e-mail.
  // Arquiva repetições antes de criar a mesma garantia usada no PostgreSQL.
  db.exec(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(email)) ORDER BY (email_verified_at IS NOT NULL) DESC, created_at, id) AS position
      FROM users WHERE account_status = 'active'
    )
    UPDATE users
    SET email = 'archived-duplicate-' || id || '@${ARCHIVED_DUPLICATE_DOMAIN}',
        password_hash = '${ARCHIVED_DUPLICATE_PASSWORD}',
        account_status = 'archived_duplicate'
    WHERE id IN (SELECT id FROM ranked WHERE position > 1);
    UPDATE users SET email = LOWER(TRIM(email)) WHERE account_status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(LOWER(TRIM(email)));
  `);
  const billingColumns = db.prepare("PRAGMA table_info(billing_profiles)").all();
  if (!billingColumns.some((column) => column.name === "provider_subscription_id")) {
    db.exec("ALTER TABLE billing_profiles ADD COLUMN provider_subscription_id TEXT");
  }
  if (!billingColumns.some((column) => column.name === "provider_price_id")) {
    db.exec("ALTER TABLE billing_profiles ADD COLUMN provider_price_id TEXT");
  }
  if (!billingColumns.some((column) => column.name === "subscription_current_period_end")) {
    db.exec("ALTER TABLE billing_profiles ADD COLUMN subscription_current_period_end TEXT");
  }
  // Migra bancos locais já existentes sem apagar membros nem convites.
  const memberColumns = db.prepare("PRAGMA table_info(organization_members)").all();
  if (!memberColumns.some((column) => column.name === "job_title")) {
    db.exec("ALTER TABLE organization_members ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
  }
  const invitationColumns = db.prepare("PRAGMA table_info(organization_invitations)").all();
  if (!invitationColumns.some((column) => column.name === "job_title")) {
    db.exec("ALTER TABLE organization_invitations ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
  }
  const historyColumns = db.prepare("PRAGMA table_info(histories)").all();
  if (!historyColumns.some((column) => column.name === "public_id")) {
    db.exec("ALTER TABLE histories ADD COLUMN public_id TEXT");
  }
  const historiesWithoutPublicId = db.prepare("SELECT id FROM histories WHERE public_id IS NULL").all();
  const setPublicId = db.prepare("UPDATE histories SET public_id = ? WHERE id = ? AND public_id IS NULL");
  for (const row of historiesWithoutPublicId) setPublicId.run(randomUUID(), row.id);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_histories_public_id ON histories(public_id)");

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

export async function closeDatabaseForTests() {
  if (process.env.NODE_ENV !== "test" || !backendPromise) return;
  const backend = await backendPromise;
  if (backend.type === "sqlite") backend.db.close();
  backendPromise = undefined;
}

export async function createUser({ name, email, passwordHash, accountType = "person", legalAcceptance = null }) {
  const backend = await getBackend();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const acceptedAt = legalAcceptance?.acceptedAt || null;
  const termsVersion = legalAcceptance?.termsVersion || null;
  const privacyVersion = legalAcceptance?.privacyVersion || null;
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO users (name, email, password_hash, account_type, email_verification_required, legal_accepted_at, terms_version, privacy_version)
      VALUES (${name}, ${normalizedEmail}, ${passwordHash}, ${accountType}, TRUE, ${acceptedAt}, ${termsVersion}, ${privacyVersion})
      RETURNING id, name, email, account_type, email_verified_at, email_verification_required, legal_accepted_at, terms_version, privacy_version
    `;
    return { ...rows[0], id: Number(rows[0].id) };
  }

  const result = backend.db
    .prepare("INSERT INTO users (name, email, password_hash, account_type, email_verification_required, legal_accepted_at, terms_version, privacy_version) VALUES (?, ?, ?, ?, 1, ?, ?, ?)")
    .run(name, normalizedEmail, passwordHash, accountType, acceptedAt, termsVersion, privacyVersion);
  return { id: Number(result.lastInsertRowid), name, email: normalizedEmail, account_type: accountType, accountType, email_verification_required: 1, legal_accepted_at: acceptedAt, terms_version: termsVersion, privacy_version: privacyVersion };
}

export async function findUserByEmail(email) {
  const backend = await getBackend();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT id, name, email, password_hash, account_type, email_verified_at, email_verification_required, legal_accepted_at, terms_version, privacy_version
      FROM users WHERE account_status = 'active' AND LOWER(BTRIM(email)) = ${normalizedEmail}
    `;
    return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
  }
  return backend.db.prepare("SELECT * FROM users WHERE account_status = 'active' AND LOWER(TRIM(email)) = ?").get(normalizedEmail) || null;
}

// Módulos de domínio no servidor reutilizam a mesma conexão e continuam sem
// expor credenciais ou o cliente do banco para o navegador.
export async function getDatabaseBackend() {
  return getBackend();
}

export async function findUserById(id) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT id, name, email, account_type, email_verified_at, email_verification_required, legal_accepted_at, terms_version, privacy_version FROM users WHERE id = ${id} AND account_status = 'active'
    `;
    return rows[0] || null;
  }
  return backend.db
    .prepare("SELECT id, name, email, account_type, email_verified_at, email_verification_required, legal_accepted_at, terms_version, privacy_version FROM users WHERE id = ? AND account_status = 'active'")
    .get(id) || null;
}

export async function recordLegalAcceptance({ userId, acceptedAt, termsVersion, privacyVersion }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    await backend.sql`
      UPDATE users SET legal_accepted_at = ${acceptedAt}, terms_version = ${termsVersion}, privacy_version = ${privacyVersion}
      WHERE id = ${userId}
    `;
  } else {
    backend.db.prepare("UPDATE users SET legal_accepted_at = ?, terms_version = ?, privacy_version = ? WHERE id = ?")
      .run(acceptedAt, termsVersion, privacyVersion, userId);
  }
  return findUserById(userId);
}

export async function createAuthSession({ sessionHash, userId, expiresAt }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    await backend.sql`
      INSERT INTO auth_sessions (session_hash, user_id, expires_at)
      VALUES (${sessionHash}, ${userId}, ${expiresAt.toISOString()})
    `;
    if (Math.random() < 0.02) {
      await backend.sql`DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '7 days'`;
    }
    return;
  }
  backend.db.prepare("INSERT INTO auth_sessions (session_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sessionHash, userId, expiresAt.toISOString());
  if (Math.random() < 0.02) {
    backend.db.prepare("DELETE FROM auth_sessions WHERE datetime(expires_at) < datetime('now', '-7 days')").run();
  }
}

export async function findActiveAuthSession(sessionHash) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT user_id, expires_at, last_seen_at FROM auth_sessions
      WHERE session_hash = ${sessionHash} AND revoked_at IS NULL AND expires_at > NOW()
    `;
    if (rows[0] && Date.now() - new Date(rows[0].last_seen_at).getTime() > 300_000) {
      await backend.sql`UPDATE auth_sessions SET last_seen_at = NOW() WHERE session_hash = ${sessionHash}`;
    }
    return rows[0] ? { userId: Number(rows[0].user_id), expiresAt: rows[0].expires_at } : null;
  }
  const row = backend.db.prepare(
    "SELECT user_id, expires_at, last_seen_at FROM auth_sessions WHERE session_hash = ? AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP",
  ).get(sessionHash);
  if (!row) return null;
  if (Date.now() - new Date(`${String(row.last_seen_at).replace(" ", "T")}Z`).getTime() > 300_000) {
    backend.db.prepare("UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_hash = ?").run(sessionHash);
  }
  return { userId: Number(row.user_id), expiresAt: row.expires_at };
}

export async function revokeAuthSession(sessionHash) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      UPDATE auth_sessions SET revoked_at = NOW()
      WHERE session_hash = ${sessionHash} AND revoked_at IS NULL
      RETURNING session_hash
    `;
    return rows.length > 0;
  }
  return backend.db.prepare(
    "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_hash = ? AND revoked_at IS NULL",
  ).run(sessionHash).changes > 0;
}

export async function createAuthActionToken({ userId, purpose, tokenHash, expiresAt }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    await backend.sql`
      UPDATE auth_action_tokens SET used_at = NOW()
      WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL
    `;
    await backend.sql`
      INSERT INTO auth_action_tokens (token_hash, user_id, purpose, expires_at)
      VALUES (${tokenHash}, ${userId}, ${purpose}, ${expiresAt.toISOString()})
    `;
    return;
  }
  backend.db.exec("BEGIN IMMEDIATE");
  try {
    backend.db.prepare(
      "UPDATE auth_action_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
    ).run(userId, purpose);
    backend.db.prepare(
      "INSERT INTO auth_action_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)",
    ).run(tokenHash, userId, purpose, expiresAt.toISOString());
    backend.db.exec("COMMIT");
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function consumeEmailVerificationToken(tokenHash) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      WITH consumed AS (
        UPDATE auth_action_tokens SET used_at = NOW()
        WHERE token_hash = ${tokenHash} AND purpose = 'verify_email'
          AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id
      )
      UPDATE users SET email_verified_at = NOW(), email_verification_required = FALSE
      WHERE id = (SELECT user_id FROM consumed)
      RETURNING id, name, email, account_type, email_verified_at, email_verification_required
    `;
    return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
  }
  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const token = backend.db.prepare(
      "SELECT user_id FROM auth_action_tokens WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP",
    ).get(tokenHash);
    if (!token) { backend.db.exec("COMMIT"); return null; }
    const changed = backend.db.prepare(
      "UPDATE auth_action_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL",
    ).run(tokenHash).changes;
    if (!changed) { backend.db.exec("COMMIT"); return null; }
    backend.db.prepare(
      "UPDATE users SET email_verified_at = CURRENT_TIMESTAMP, email_verification_required = 0 WHERE id = ?",
    ).run(token.user_id);
    const user = backend.db.prepare(
      "SELECT id, name, email, account_type, email_verified_at, email_verification_required FROM users WHERE id = ?",
    ).get(token.user_id);
    backend.db.exec("COMMIT");
    return user;
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function resetPasswordWithToken({ tokenHash, passwordHash }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      WITH consumed AS (
        UPDATE auth_action_tokens SET used_at = NOW()
        WHERE token_hash = ${tokenHash} AND purpose = 'reset_password'
          AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id
      )
      UPDATE users SET password_hash = ${passwordHash},
        email_verified_at = COALESCE(email_verified_at, NOW()), email_verification_required = FALSE
      WHERE id = (SELECT user_id FROM consumed)
      RETURNING id, email
    `;
    if (!rows[0]) return null;
    await backend.sql`
      UPDATE auth_sessions SET revoked_at = NOW()
      WHERE user_id = ${rows[0].id} AND revoked_at IS NULL
    `;
    return { ...rows[0], id: Number(rows[0].id) };
  }
  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const token = backend.db.prepare(
      "SELECT user_id FROM auth_action_tokens WHERE token_hash = ? AND purpose = 'reset_password' AND used_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP",
    ).get(tokenHash);
    if (!token) { backend.db.exec("COMMIT"); return null; }
    const changed = backend.db.prepare(
      "UPDATE auth_action_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL",
    ).run(tokenHash).changes;
    if (!changed) { backend.db.exec("COMMIT"); return null; }
    backend.db.prepare(
      "UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), email_verification_required = 0 WHERE id = ?",
    ).run(passwordHash, token.user_id);
    backend.db.prepare(
      "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
    ).run(token.user_id);
    const user = backend.db.prepare("SELECT id, email FROM users WHERE id = ?").get(token.user_id);
    backend.db.exec("COMMIT");
    return user;
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function appendAuditEvent({ userId = null, action, metadata = {} }) {
  const backend = await getBackend();
  const minimized = JSON.stringify(metadata).slice(0, 2_000);
  if (backend.type === "postgres") {
    await backend.sql`
      INSERT INTO audit_events (user_id, action, metadata)
      VALUES (${userId}, ${String(action).slice(0, 80)}, ${minimized}::jsonb)
    `;
    return;
  }
  backend.db.prepare("INSERT INTO audit_events (user_id, action, metadata) VALUES (?, ?, ?)")
    .run(userId, String(action).slice(0, 80), minimized);
}

function serializeBillingProfile(row, fallbackType = "person") {
  return {
    accountType: row?.account_type || fallbackType,
    legalName: row?.legal_name || "",
    phone: row?.phone || "",
    postalCode: row?.postal_code || "",
    address: row?.address || "",
    addressNumber: row?.address_number || "",
    complement: row?.complement || "",
    district: row?.district || "",
    city: row?.city || "",
    state: row?.state || "",
    subscriptionStatus: row?.subscription_status || "not_subscriber",
    paymentProvider: row?.payment_provider || "",
    subscriptionCurrentPeriodEnd: row?.subscription_current_period_end || null,
  };
}

export async function getBillingProfile(userId, fallbackType = "person") {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`SELECT * FROM billing_profiles WHERE user_id = ${userId}`;
    return serializeBillingProfile(rows[0], fallbackType);
  }
  return serializeBillingProfile(
    backend.db.prepare("SELECT * FROM billing_profiles WHERE user_id = ?").get(userId),
    fallbackType,
  );
}

export async function saveBillingProfile({ userId, profile }) {
  const backend = await getBackend();
  const values = {
    accountType: profile.accountType,
    legalName: profile.legalName,
    phone: profile.phone,
    postalCode: profile.postalCode,
    address: profile.address,
    addressNumber: profile.addressNumber,
    complement: profile.complement,
    district: profile.district,
    city: profile.city,
    state: profile.state,
  };
  if (backend.type === "postgres") {
    await backend.sql`UPDATE users SET account_type = ${values.accountType} WHERE id = ${userId}`;
    const rows = await backend.sql`
      INSERT INTO billing_profiles (
        user_id, account_type, legal_name, phone, postal_code,
        address, address_number, complement, district, city, state
      ) VALUES (
        ${userId}, ${values.accountType}, ${values.legalName}, ${values.phone},
        ${values.postalCode}, ${values.address}, ${values.addressNumber}, ${values.complement},
        ${values.district}, ${values.city}, ${values.state}
      ) ON CONFLICT (user_id) DO UPDATE SET
        account_type = EXCLUDED.account_type, legal_name = EXCLUDED.legal_name,
        phone = EXCLUDED.phone, postal_code = EXCLUDED.postal_code,
        address = EXCLUDED.address, address_number = EXCLUDED.address_number,
        complement = EXCLUDED.complement, district = EXCLUDED.district,
        city = EXCLUDED.city, state = EXCLUDED.state, updated_at = NOW()
      RETURNING *
    `;
    return serializeBillingProfile(rows[0]);
  }
  backend.db.prepare("UPDATE users SET account_type = ? WHERE id = ?").run(values.accountType, userId);
  backend.db.prepare(`
    INSERT INTO billing_profiles (
      user_id, account_type, legal_name, phone, postal_code,
      address, address_number, complement, district, city, state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      account_type = excluded.account_type, legal_name = excluded.legal_name,
      phone = excluded.phone, postal_code = excluded.postal_code,
      address = excluded.address, address_number = excluded.address_number,
      complement = excluded.complement, district = excluded.district,
      city = excluded.city, state = excluded.state, updated_at = CURRENT_TIMESTAMP
  `).run(
    userId, values.accountType, values.legalName, values.phone, values.postalCode,
    values.address, values.addressNumber, values.complement, values.district, values.city, values.state,
  );
  return getBillingProfile(userId, values.accountType);
}

export async function getBillingProviderState(userId) {
  const backend = await getBackend();
  const row = backend.type === "postgres"
    ? (await backend.sql`SELECT payment_provider, provider_customer_id, provider_subscription_id, provider_price_id, subscription_status, subscription_current_period_end FROM billing_profiles WHERE user_id = ${userId}`)[0]
    : backend.db.prepare("SELECT payment_provider, provider_customer_id, provider_subscription_id, provider_price_id, subscription_status, subscription_current_period_end FROM billing_profiles WHERE user_id = ?").get(userId);
  return row ? {
    paymentProvider: row.payment_provider || "",
    customerId: row.provider_customer_id || "",
    subscriptionId: row.provider_subscription_id || "",
    priceId: row.provider_price_id || "",
    status: row.subscription_status || "not_subscriber",
    currentPeriodEnd: row.subscription_current_period_end || null,
  } : { paymentProvider: "", customerId: "", subscriptionId: "", priceId: "", status: "not_subscriber", currentPeriodEnd: null };
}

export const MAX_ORGANIZATION_MEMBERS = 10;
export const MAX_ORGANIZATION_JOBS = 25;

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

function serializeOrganizationAccess(row) {
  if (!row) return null;
  return {
    organizationId: Number(row.organization_id || row.id),
    organizationName: row.organization_name || row.name,
    ownerUserId: Number(row.owner_user_id),
    role: row.role,
    jobTitle: row.job_title || (row.role === "owner" ? "Proprietário da operação" : ""),
    status: row.status || "active",
    permissions: row.role === "owner" ? ALL_TEAM_PERMISSIONS : normalizePermissions(parsePermissions(row.permissions), row.role),
  };
}

function serializeOrganizationJob(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    organization_id: Number(row.organization_id),
    permissions: normalizePermissions(parsePermissions(row.permissions), row.role),
  };
}

export async function listOrganizationJobs(organizationId) {
  const backend = await getBackend();
  const rows = backend.type === "postgres"
    ? await backend.sql`
        SELECT id, organization_id, name, role, permissions, created_at, updated_at
        FROM organization_jobs
        WHERE organization_id = ${organizationId}
        ORDER BY LOWER(name)
      `
    : backend.db.prepare(`
        SELECT id, organization_id, name, role, permissions, created_at, updated_at
        FROM organization_jobs
        WHERE organization_id = ?
        ORDER BY name COLLATE NOCASE
      `).all(organizationId);
  return rows.map(serializeOrganizationJob);
}

export async function findOrganizationJob({ organizationId, jobId }) {
  const backend = await getBackend();
  const rows = backend.type === "postgres"
    ? await backend.sql`
        SELECT id, organization_id, name, role, permissions, created_at, updated_at
        FROM organization_jobs
        WHERE organization_id = ${organizationId} AND id = ${jobId}
        LIMIT 1
      `
    : [backend.db.prepare(`
        SELECT id, organization_id, name, role, permissions, created_at, updated_at
        FROM organization_jobs
        WHERE organization_id = ? AND id = ?
      `).get(organizationId, jobId)].filter(Boolean);
  return serializeOrganizationJob(rows[0]);
}

function organizationJobError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function createOrganizationJob({ organizationId, name, role, permissions }) {
  const backend = await getBackend();
  const safeName = String(name || "").trim().slice(0, 80);
  const safeRole = normalizeRole(role);
  const safePermissions = normalizePermissions(permissions, safeRole);
  const serialized = JSON.stringify(safePermissions);
  if (backend.type === "postgres") {
    const count = await backend.sql`SELECT COUNT(*)::int AS count FROM organization_jobs WHERE organization_id = ${organizationId}`;
    if (Number(count[0].count) >= MAX_ORGANIZATION_JOBS) throw organizationJobError("JOB_LIMIT_REACHED");
    try {
      const rows = await backend.sql`
        INSERT INTO organization_jobs (organization_id, name, role, permissions)
        VALUES (${organizationId}, ${safeName}, ${safeRole}, ${serialized}::jsonb)
        RETURNING id, organization_id, name, role, permissions, created_at, updated_at
      `;
      return serializeOrganizationJob(rows[0]);
    } catch (error) {
      if (error?.code === "23505") throw organizationJobError("JOB_ALREADY_EXISTS");
      throw error;
    }
  }
  const count = backend.db.prepare("SELECT COUNT(*) AS count FROM organization_jobs WHERE organization_id = ?").get(organizationId);
  if (Number(count.count) >= MAX_ORGANIZATION_JOBS) throw organizationJobError("JOB_LIMIT_REACHED");
  try {
    const result = backend.db.prepare(`
      INSERT INTO organization_jobs (organization_id, name, role, permissions)
      VALUES (?, ?, ?, ?)
    `).run(organizationId, safeName, safeRole, serialized);
    return findOrganizationJob({ organizationId, jobId: Number(result.lastInsertRowid) });
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT") || /UNIQUE constraint failed/i.test(String(error?.message || ""))) {
      throw organizationJobError("JOB_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function updateOrganizationJob({ organizationId, jobId, name, role, permissions }) {
  const backend = await getBackend();
  const current = await findOrganizationJob({ organizationId, jobId });
  if (!current) return null;
  const safeName = String(name || "").trim().slice(0, 80);
  const safeRole = normalizeRole(role);
  const safePermissions = normalizePermissions(permissions, safeRole);
  const serialized = JSON.stringify(safePermissions);
  try {
    if (backend.type === "postgres") {
      const rows = await backend.sql`
        UPDATE organization_jobs
        SET name = ${safeName}, role = ${safeRole}, permissions = ${serialized}::jsonb, updated_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${jobId}
        RETURNING id, organization_id, name, role, permissions, created_at, updated_at
      `;
      if (!rows.length) return null;
      await backend.sql`
        UPDATE organization_members
        SET job_title = ${safeName}, role = ${safeRole}, permissions = ${serialized}::jsonb, updated_at = NOW()
        WHERE organization_id = ${organizationId} AND role <> 'owner' AND job_title = ${current.name}
      `;
      await backend.sql`
        UPDATE organization_invitations
        SET job_title = ${safeName}, role = ${safeRole}, permissions = ${serialized}::jsonb
        WHERE organization_id = ${organizationId} AND accepted_at IS NULL AND revoked_at IS NULL AND job_title = ${current.name}
      `;
      return serializeOrganizationJob(rows[0]);
    }
    const result = backend.db.prepare(`
      UPDATE organization_jobs SET name = ?, role = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND id = ?
    `).run(safeName, safeRole, serialized, organizationId, jobId);
    if (!result.changes) return null;
    backend.db.prepare(`
      UPDATE organization_members SET job_title = ?, role = ?, permissions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND role <> 'owner' AND job_title = ?
    `).run(safeName, safeRole, serialized, organizationId, current.name);
    backend.db.prepare(`
      UPDATE organization_invitations SET job_title = ?, role = ?, permissions = ?
      WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND job_title = ?
    `).run(safeName, safeRole, serialized, organizationId, current.name);
    return findOrganizationJob({ organizationId, jobId });
  } catch (error) {
    if (error?.code === "23505" || String(error?.code || "").startsWith("SQLITE_CONSTRAINT") || /UNIQUE constraint failed/i.test(String(error?.message || ""))) {
      throw organizationJobError("JOB_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function removeOrganizationJob({ organizationId, jobId }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`DELETE FROM organization_jobs WHERE organization_id = ${organizationId} AND id = ${jobId} RETURNING id`;
    return rows.length > 0;
  }
  return backend.db.prepare("DELETE FROM organization_jobs WHERE organization_id = ? AND id = ?").run(organizationId, jobId).changes > 0;
}

export async function ensureOwnedOrganization({ userId, name }) {
  const backend = await getBackend();
  const safeName = String(name || "Minha empresa").trim().slice(0, 100) || "Minha empresa";
  const permissions = JSON.stringify(ALL_TEAM_PERMISSIONS);
  if (backend.type === "postgres") {
    await backend.sql`
      INSERT INTO organizations (name, owner_user_id)
      VALUES (${safeName}, ${userId})
      ON CONFLICT (owner_user_id) DO NOTHING
    `;
    const organizations = await backend.sql`SELECT id, name, owner_user_id FROM organizations WHERE owner_user_id = ${userId}`;
    const organization = organizations[0];
    await backend.sql`
      INSERT INTO organization_members (organization_id, user_id, role, job_title, permissions, status)
      VALUES (${organization.id}, ${userId}, 'owner', 'Proprietário da operação', ${permissions}::jsonb, 'active')
      ON CONFLICT (user_id) DO UPDATE SET
        role = 'owner', job_title = 'Proprietário da operação', permissions = EXCLUDED.permissions, status = 'active', updated_at = NOW()
    `;
    return serializeOrganizationAccess({ ...organization, organization_id: organization.id, organization_name: organization.name, role: "owner" });
  }
  backend.db.prepare("INSERT OR IGNORE INTO organizations (name, owner_user_id) VALUES (?, ?)").run(safeName, userId);
  const organization = backend.db.prepare("SELECT id, name, owner_user_id FROM organizations WHERE owner_user_id = ?").get(userId);
  backend.db.prepare(`
    INSERT INTO organization_members (organization_id, user_id, role, job_title, permissions, status)
    VALUES (?, ?, 'owner', 'Proprietário da operação', ?, 'active')
    ON CONFLICT(user_id) DO UPDATE SET
      role = 'owner', job_title = 'Proprietário da operação', permissions = excluded.permissions, status = 'active', updated_at = CURRENT_TIMESTAMP
  `).run(organization.id, userId, permissions);
  return serializeOrganizationAccess({ ...organization, organization_id: organization.id, organization_name: organization.name, role: "owner" });
}

export async function findOrganizationAccess(userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT m.organization_id, o.name AS organization_name, o.owner_user_id,
             m.role, m.job_title, m.permissions, m.status
      FROM organization_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId} AND m.status = 'active'
      LIMIT 1
    `;
    return serializeOrganizationAccess(rows[0]);
  }
  return serializeOrganizationAccess(backend.db.prepare(`
    SELECT m.organization_id, o.name AS organization_name, o.owner_user_id,
           m.role, m.job_title, m.permissions, m.status
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ? AND m.status = 'active'
    LIMIT 1
  `).get(userId));
}

export async function listOrganizationTeam(organizationId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const members = await backend.sql`
      SELECT m.user_id AS id, u.name, u.email, m.role, m.job_title, m.permissions, m.status, m.created_at
      FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name
    `;
    const invitations = await backend.sql`
      SELECT id, email, role, job_title, permissions, expires_at, created_at
      FROM organization_invitations
      WHERE organization_id = ${organizationId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    const jobs = await listOrganizationJobs(organizationId);
    return {
      members: members.map((row) => ({ ...row, id: Number(row.id), permissions: row.role === "owner" ? ALL_TEAM_PERMISSIONS : parsePermissions(row.permissions) })),
      invitations: invitations.map((row) => ({ ...row, id: Number(row.id), permissions: parsePermissions(row.permissions) })),
      jobs,
    };
  }
  const members = backend.db.prepare(`
    SELECT m.user_id AS id, u.name, u.email, m.role, m.job_title, m.permissions, m.status, m.created_at
    FROM organization_members m JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name
  `).all(organizationId).map((row) => ({ ...row, id: Number(row.id), permissions: row.role === "owner" ? ALL_TEAM_PERMISSIONS : parsePermissions(row.permissions) }));
  const invitations = backend.db.prepare(`
    SELECT id, email, role, job_title, permissions, expires_at, created_at
    FROM organization_invitations
    WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
  `).all(organizationId).map((row) => ({ ...row, id: Number(row.id), permissions: parsePermissions(row.permissions) }));
  const jobs = await listOrganizationJobs(organizationId);
  return { members, invitations, jobs };
}

export async function createOrganizationInvitation({ organizationId, email, role, jobTitle = "", permissions, tokenHash, invitedBy, expiresAt }) {
  const backend = await getBackend();
  const safeRole = normalizeRole(role);
  const safePermissions = normalizePermissions(permissions, safeRole);
  const safeJobTitle = String(jobTitle || "").trim().slice(0, 80);
  const serialized = JSON.stringify(safePermissions);
  if (backend.type === "postgres") {
    const counts = await backend.sql`
      SELECT
        (SELECT COUNT(*)::int FROM organization_members WHERE organization_id = ${organizationId}) AS members,
        (SELECT COUNT(*)::int FROM organization_invitations WHERE organization_id = ${organizationId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS invitations
    `;
    if (Number(counts[0].members) + Number(counts[0].invitations) >= MAX_ORGANIZATION_MEMBERS) {
      const error = new Error("team_limit_reached"); error.code = "TEAM_LIMIT_REACHED"; throw error;
    }
    await backend.sql`
      UPDATE organization_invitations SET revoked_at = NOW()
      WHERE organization_id = ${organizationId} AND email = ${email} AND accepted_at IS NULL AND revoked_at IS NULL
    `;
    const rows = await backend.sql`
      INSERT INTO organization_invitations (organization_id, email, role, job_title, permissions, token_hash, invited_by, expires_at)
      VALUES (${organizationId}, ${email}, ${safeRole}, ${safeJobTitle}, ${serialized}::jsonb, ${tokenHash}, ${invitedBy}, ${expiresAt.toISOString()})
      RETURNING id, email, role, job_title, permissions, expires_at, created_at
    `;
    return { ...rows[0], id: Number(rows[0].id), permissions: parsePermissions(rows[0].permissions) };
  }
  const members = backend.db.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = ?").get(organizationId).count;
  const invitations = backend.db.prepare("SELECT COUNT(*) AS count FROM organization_invitations WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP").get(organizationId).count;
  if (Number(members) + Number(invitations) >= MAX_ORGANIZATION_MEMBERS) {
    const error = new Error("team_limit_reached"); error.code = "TEAM_LIMIT_REACHED"; throw error;
  }
  backend.db.prepare("UPDATE organization_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL").run(organizationId, email);
  const result = backend.db.prepare(`
    INSERT INTO organization_invitations (organization_id, email, role, job_title, permissions, token_hash, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(organizationId, email, safeRole, safeJobTitle, serialized, tokenHash, invitedBy, expiresAt.toISOString());
  return { id: Number(result.lastInsertRowid), email, role: safeRole, job_title: safeJobTitle, permissions: safePermissions, expires_at: expiresAt.toISOString() };
}

export async function findOrganizationInvitation(tokenHash) {
  const backend = await getBackend();
  const query = backend.type === "postgres"
    ? await backend.sql`
        SELECT i.id, i.organization_id, i.email, i.role, i.job_title, i.permissions, i.expires_at,
               o.name AS organization_name, o.owner_user_id, u.name AS inviter_name
        FROM organization_invitations i
        JOIN organizations o ON o.id = i.organization_id
        JOIN users u ON u.id = i.invited_by
        WHERE i.token_hash = ${tokenHash} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
      `
    : [backend.db.prepare(`
        SELECT i.id, i.organization_id, i.email, i.role, i.job_title, i.permissions, i.expires_at,
               o.name AS organization_name, o.owner_user_id, u.name AS inviter_name
        FROM organization_invitations i
        JOIN organizations o ON o.id = i.organization_id
        JOIN users u ON u.id = i.invited_by
        WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND datetime(i.expires_at) > CURRENT_TIMESTAMP
      `).get(tokenHash)].filter(Boolean);
  const row = query[0];
  return row ? { ...row, id: Number(row.id), organization_id: Number(row.organization_id), owner_user_id: Number(row.owner_user_id), permissions: parsePermissions(row.permissions) } : null;
}

function organizationConflict(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function releaseEmptyOwnedOrganization({ backend, userId, targetOrganizationId }) {
  if (backend.type === "postgres") {
    const memberships = await backend.sql`
      SELECT m.organization_id, m.role, o.owner_user_id
      FROM organization_members m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId} LIMIT 1
    `;
    const membership = memberships[0];
    if (!membership || Number(membership.organization_id) === Number(targetOrganizationId)) return;
    if (membership.role !== "owner" || Number(membership.owner_user_id) !== Number(userId)) throw organizationConflict("ACCOUNT_ALREADY_IN_ORGANIZATION");
    const summary = await backend.sql`
      SELECT
        (SELECT COUNT(*)::int FROM organization_members WHERE organization_id = ${membership.organization_id}) AS members,
        (SELECT COUNT(*)::int FROM organization_invitations WHERE organization_id = ${membership.organization_id} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS invitations,
        (SELECT COUNT(*)::int FROM organization_jobs WHERE organization_id = ${membership.organization_id}) AS jobs,
        (SELECT COUNT(*)::int FROM histories WHERE user_id = ${userId}) AS histories,
        COALESCE((SELECT subscription_status FROM billing_profiles WHERE user_id = ${userId}), 'not_subscriber') AS subscription_status
    `;
    const workspaces = await backend.sql`SELECT payload FROM workspaces WHERE user_id = ${userId}`;
    const hasData = hasMeaningfulWorkspaceContent(workspaces[0]?.payload || {});
    if (Number(summary[0].members) !== 1 || Number(summary[0].invitations) !== 0 || Number(summary[0].jobs) !== 0 || Number(summary[0].histories) !== 0 || summary[0].subscription_status !== "not_subscriber" || hasData) {
      throw organizationConflict("OWNED_ORGANIZATION_NOT_EMPTY");
    }
    // O espaço foi criado automaticamente e está vazio; removê-lo libera a conta para o convite.
    await backend.sql`DELETE FROM organizations WHERE id = ${membership.organization_id} AND owner_user_id = ${userId}`;
    return;
  }

  const membership = backend.db.prepare(`
    SELECT m.organization_id, m.role, o.owner_user_id
    FROM organization_members m JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ? LIMIT 1
  `).get(userId);
  if (!membership || Number(membership.organization_id) === Number(targetOrganizationId)) return;
  if (membership.role !== "owner" || Number(membership.owner_user_id) !== Number(userId)) throw organizationConflict("ACCOUNT_ALREADY_IN_ORGANIZATION");
  const members = backend.db.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = ?").get(membership.organization_id).count;
  const invitations = backend.db.prepare("SELECT COUNT(*) AS count FROM organization_invitations WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP").get(membership.organization_id).count;
  const jobs = backend.db.prepare("SELECT COUNT(*) AS count FROM organization_jobs WHERE organization_id = ?").get(membership.organization_id).count;
  const histories = backend.db.prepare("SELECT COUNT(*) AS count FROM histories WHERE user_id = ?").get(userId).count;
  const billing = backend.db.prepare("SELECT subscription_status FROM billing_profiles WHERE user_id = ?").get(userId);
  const workspace = backend.db.prepare("SELECT payload FROM workspaces WHERE user_id = ?").get(userId);
  const payload = workspace?.payload ? JSON.parse(workspace.payload) : {};
  if (Number(members) !== 1 || Number(invitations) !== 0 || Number(jobs) !== 0 || Number(histories) !== 0 || (billing?.subscription_status || "not_subscriber") !== "not_subscriber" || hasMeaningfulWorkspaceContent(payload)) {
    throw organizationConflict("OWNED_ORGANIZATION_NOT_EMPTY");
  }
  backend.db.prepare("DELETE FROM organizations WHERE id = ? AND owner_user_id = ?").run(membership.organization_id, userId);
}

export async function acceptOrganizationInvitation({ tokenHash, userId, email }) {
  const invitation = await findOrganizationInvitation(tokenHash);
  if (!invitation || invitation.email.toLowerCase() !== String(email).toLowerCase()) return null;
  const backend = await getBackend();
  const serialized = JSON.stringify(normalizePermissions(invitation.permissions, invitation.role));
  try {
    await releaseEmptyOwnedOrganization({ backend, userId, targetOrganizationId: invitation.organization_id });
    if (backend.type === "postgres") {
      const rows = await backend.sql`
        INSERT INTO organization_members (organization_id, user_id, role, job_title, permissions, status)
        VALUES (${invitation.organization_id}, ${userId}, ${invitation.role}, ${invitation.job_title || ""}, ${serialized}::jsonb, 'active')
        ON CONFLICT (user_id) DO NOTHING
        RETURNING user_id
      `;
      if (!rows.length) return null;
      await backend.sql`UPDATE organization_invitations SET accepted_at = NOW() WHERE id = ${invitation.id} AND accepted_at IS NULL`;
    } else {
      const result = backend.db.prepare(`
        INSERT OR IGNORE INTO organization_members (organization_id, user_id, role, job_title, permissions, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(invitation.organization_id, userId, invitation.role, invitation.job_title || "", serialized);
      if (!result.changes) return null;
      backend.db.prepare("UPDATE organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND accepted_at IS NULL").run(invitation.id);
    }
    return findOrganizationAccess(userId);
  } catch (error) {
    if (["ACCOUNT_ALREADY_IN_ORGANIZATION", "OWNED_ORGANIZATION_NOT_EMPTY"].includes(error?.code)) throw error;
    return null;
  }
}

export async function updateOrganizationMember({ organizationId, userId, role, jobTitle = "", permissions, status = "active" }) {
  const backend = await getBackend();
  const safeRole = normalizeRole(role);
  const serialized = JSON.stringify(normalizePermissions(permissions, safeRole));
  const safeStatus = status === "suspended" ? "suspended" : "active";
  const safeJobTitle = String(jobTitle || "").trim().slice(0, 80);
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      UPDATE organization_members SET role = ${safeRole}, job_title = ${safeJobTitle}, permissions = ${serialized}::jsonb,
        status = ${safeStatus}, updated_at = NOW()
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND role <> 'owner'
      RETURNING user_id AS id, role, job_title, permissions, status
    `;
    return rows[0] ? { ...rows[0], id: Number(rows[0].id), permissions: parsePermissions(rows[0].permissions) } : null;
  }
  const result = backend.db.prepare(`
    UPDATE organization_members SET role = ?, job_title = ?, permissions = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE organization_id = ? AND user_id = ? AND role <> 'owner'
  `).run(safeRole, safeJobTitle, serialized, safeStatus, organizationId, userId);
  return result.changes ? { id: userId, role: safeRole, job_title: safeJobTitle, permissions: JSON.parse(serialized), status: safeStatus } : null;
}

export async function removeOrganizationMember({ organizationId, userId }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`DELETE FROM organization_members WHERE organization_id = ${organizationId} AND user_id = ${userId} AND role <> 'owner' RETURNING user_id`;
    return rows.length > 0;
  }
  return backend.db.prepare("DELETE FROM organization_members WHERE organization_id = ? AND user_id = ? AND role <> 'owner'").run(organizationId, userId).changes > 0;
}

export async function revokeOrganizationInvitation({ organizationId, invitationId }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE organization_invitations SET revoked_at = NOW() WHERE organization_id = ${organizationId} AND id = ${invitationId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`;
    return rows.length > 0;
  }
  return backend.db.prepare("UPDATE organization_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND id = ? AND accepted_at IS NULL AND revoked_at IS NULL").run(organizationId, invitationId).changes > 0;
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
    // Cada conta possui um único rascunho contínuo; sair atualiza o mesmo registro.
    const candidates = await backend.sql`
      UPDATE workspaces SET archived_revision = revision
      WHERE user_id = ${userId} AND revision > archived_revision
      RETURNING payload
    `;
    if (!candidates.length) return null;
    const updated = await backend.sql`
      UPDATE histories SET title = ${title}, payload = ${JSON.stringify(candidates[0].payload)}::jsonb, created_at = NOW()
      WHERE id = (SELECT id FROM histories WHERE user_id = ${userId} AND calculation_type = 'rascunho-automatico' ORDER BY id DESC LIMIT 1)
      RETURNING public_id AS id, title, calculation_type, payload, created_at
    `;
    if (updated.length) return updated[0];
    const inserted = await backend.sql`
      INSERT INTO histories (public_id, user_id, title, calculation_type, payload)
      VALUES (${randomUUID()}, ${userId}, ${title}, 'rascunho-automatico', ${JSON.stringify(candidates[0].payload)}::jsonb)
      RETURNING public_id AS id, title, calculation_type, payload, created_at
    `;
    return inserted[0];
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
    const existing = backend.db.prepare("SELECT public_id FROM histories WHERE user_id = ? AND calculation_type = 'rascunho-automatico' ORDER BY id DESC LIMIT 1").get(userId);
    const publicId = existing?.public_id || randomUUID();
    if (existing) {
      backend.db.prepare("UPDATE histories SET title = ?, payload = ?, created_at = CURRENT_TIMESTAMP WHERE public_id = ? AND user_id = ?")
        .run(title, JSON.stringify(current.payload), publicId, userId);
    } else {
      backend.db.prepare("INSERT INTO histories (public_id, user_id, title, calculation_type, payload) VALUES (?, ?, ?, 'rascunho-automatico', ?)")
        .run(publicId, userId, title, JSON.stringify(current.payload));
    }
    backend.db.exec("COMMIT");
    return findHistoryById(publicId, userId);
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function listHistories(userId, calculationType) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    return calculationType
      ? backend.sql`SELECT public_id AS id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ${userId} AND calculation_type = ${calculationType} ORDER BY id DESC`
      : backend.sql`SELECT public_id AS id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ${userId} ORDER BY id DESC`;
  }

  const statement = calculationType
    ? backend.db.prepare("SELECT public_id AS id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ? AND calculation_type = ? ORDER BY id DESC")
    : backend.db.prepare("SELECT public_id AS id, title, calculation_type, payload, created_at FROM histories WHERE user_id = ? ORDER BY id DESC");
  return calculationType ? statement.all(userId, calculationType) : statement.all(userId);
}

// Métricas agregadas para moderação; nenhuma consulta retorna dados financeiros pessoais.
export async function getAdminOverview() {
  const backend = await getBackend();
  const sinceDay = Date.now() - 86_400_000;
  const sinceTenMinutes = Date.now() - 600_000;
  if (backend.type === "postgres") {
    const [users, histories, workspaces, traffic] = await Promise.all([
      backend.sql`SELECT COUNT(*)::int AS count FROM users WHERE account_status = 'active'`,
      backend.sql`SELECT COUNT(*)::int AS count FROM histories`,
      backend.sql`SELECT COUNT(*)::int AS count FROM workspaces`,
      backend.sql`SELECT COALESCE(SUM(request_count), 0)::int AS requests_day,
        COALESCE(SUM(request_count) FILTER (WHERE window_start >= ${sinceTenMinutes}), 0)::int AS requests_ten_minutes,
        COALESCE(MAX(request_count), 0)::int AS peak_per_identity
        FROM rate_limits WHERE window_start >= ${sinceDay}`,
    ]);
    return { users: users[0].count, histories: histories[0].count, workspaces: workspaces[0].count, ...traffic[0] };
  }
  const scalar = (sql, value) => Number(backend.db.prepare(sql).get(...(value === undefined ? [] : [value]))?.value || 0);
  return {
    users: scalar("SELECT COUNT(*) AS value FROM users WHERE account_status = 'active'"),
    histories: scalar("SELECT COUNT(*) AS value FROM histories"),
    workspaces: scalar("SELECT COUNT(*) AS value FROM workspaces"),
    requests_day: scalar("SELECT COALESCE(SUM(request_count), 0) AS value FROM rate_limits WHERE window_start >= ?", sinceDay),
    requests_ten_minutes: scalar("SELECT COALESCE(SUM(request_count), 0) AS value FROM rate_limits WHERE window_start >= ?", sinceTenMinutes),
    peak_per_identity: scalar("SELECT COALESCE(MAX(request_count), 0) AS value FROM rate_limits WHERE window_start >= ?", sinceDay),
  };
}

function serializeMonitoringEvent(row) {
  if (!row) return null;
  let details = row.details || {};
  if (typeof details === "string") {
    try { details = JSON.parse(details); } catch { details = {}; }
  }
  return {
    id: row.public_id,
    level: row.level,
    source: row.source,
    code: row.code,
    summary: row.summary,
    route: row.route,
    environment: row.environment,
    occurrences: Number(row.occurrences || 1),
    status: row.status,
    details,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

// Incidentes iguais são agrupados pelo fingerprint para o painel continuar legível.
export async function recordMonitoringEvent(event) {
  const backend = await getBackend();
  const values = {
    publicId: randomUUID(),
    fingerprint: String(event.fingerprint).slice(0, 128),
    level: ["error", "warning", "info"].includes(event.level) ? event.level : "error",
    source: String(event.source || "server").slice(0, 50),
    code: String(event.code || "unknown_error").slice(0, 80),
    summary: String(event.summary || "Falha registrada pelo sistema.").slice(0, 240),
    route: String(event.route || "").slice(0, 160),
    environment: String(event.environment || process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown").slice(0, 30),
    details: JSON.stringify(event.details || {}).slice(0, 2_000),
  };
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO monitoring_events (public_id, fingerprint, level, source, code, summary, route, environment, details)
      VALUES (${values.publicId}, ${values.fingerprint}, ${values.level}, ${values.source}, ${values.code}, ${values.summary}, ${values.route}, ${values.environment}, ${values.details}::jsonb)
      ON CONFLICT (fingerprint) DO UPDATE SET
        occurrences = monitoring_events.occurrences + 1,
        level = EXCLUDED.level, summary = EXCLUDED.summary, route = EXCLUDED.route,
        environment = EXCLUDED.environment, details = EXCLUDED.details,
        status = CASE WHEN monitoring_events.status = 'resolved' THEN 'open' ELSE monitoring_events.status END,
        last_seen_at = NOW()
      RETURNING *
    `;
    return serializeMonitoringEvent(rows[0]);
  }
  backend.db.prepare(`
    INSERT INTO monitoring_events (public_id, fingerprint, level, source, code, summary, route, environment, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      occurrences = occurrences + 1, level = excluded.level, summary = excluded.summary,
      route = excluded.route, environment = excluded.environment, details = excluded.details,
      status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
      last_seen_at = CURRENT_TIMESTAMP
  `).run(values.publicId, values.fingerprint, values.level, values.source, values.code, values.summary, values.route, values.environment, values.details);
  return serializeMonitoringEvent(backend.db.prepare("SELECT * FROM monitoring_events WHERE fingerprint = ?").get(values.fingerprint));
}

export async function listMonitoringEvents({ limit = 100 } = {}) {
  const backend = await getBackend();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT * FROM monitoring_events ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT ${safeLimit}`
    : backend.db.prepare("SELECT * FROM monitoring_events ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT ?").all(safeLimit);
  return rows.map(serializeMonitoringEvent);
}

export async function updateMonitoringEventStatus({ id, status }) {
  const safeStatus = ["open", "investigating", "resolved"].includes(status) ? status : null;
  if (!safeStatus) return null;
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE monitoring_events SET status = ${safeStatus}, last_seen_at = last_seen_at WHERE public_id = ${id} RETURNING *`;
    return serializeMonitoringEvent(rows[0]);
  }
  backend.db.prepare("UPDATE monitoring_events SET status = ? WHERE public_id = ?").run(safeStatus, id);
  return serializeMonitoringEvent(backend.db.prepare("SELECT * FROM monitoring_events WHERE public_id = ?").get(id));
}

function serializeSupportTicket(row, includeContact = false) {
  if (!row) return null;
  return {
    id: row.public_id,
    subject: row.subject,
    message: row.message,
    preferredChannel: row.preferred_channel,
    status: row.status,
    reply: row.admin_reply || "",
    repliedAt: row.replied_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeContact ? { requester: { name: row.user_name || "", email: row.user_email || "", phone: row.user_phone || "" } } : {}),
  };
}

export async function createSupportTicket({ userId, organizationId = null, subject, message, preferredChannel = "site" }) {
  const backend = await getBackend();
  const publicId = randomUUID();
  const channel = ["site", "email", "phone"].includes(preferredChannel) ? preferredChannel : "site";
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO support_tickets (public_id, user_id, organization_id, subject, message, preferred_channel)
      VALUES (${publicId}, ${userId}, ${organizationId}, ${subject}, ${message}, ${channel}) RETURNING *
    `;
    return serializeSupportTicket(rows[0]);
  }
  backend.db.prepare("INSERT INTO support_tickets (public_id, user_id, organization_id, subject, message, preferred_channel) VALUES (?, ?, ?, ?, ?, ?)")
    .run(publicId, userId, organizationId, subject, message, channel);
  return serializeSupportTicket(backend.db.prepare("SELECT * FROM support_tickets WHERE public_id = ?").get(publicId));
}

export async function listSupportTicketsForUser(userId) {
  const backend = await getBackend();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT * FROM support_tickets WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 100`
    : backend.db.prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100").all(userId);
  return rows.map((row) => serializeSupportTicket(row));
}

export async function listSupportTicketsForAdmin() {
  const backend = await getBackend();
  const rows = backend.type === "postgres"
    ? await backend.sql`SELECT t.*, u.name AS user_name, u.email AS user_email, COALESCE(b.phone, '') AS user_phone FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN billing_profiles b ON b.user_id = t.user_id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 200`
    : backend.db.prepare("SELECT t.*, u.name AS user_name, u.email AS user_email, COALESCE(b.phone, '') AS user_phone FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN billing_profiles b ON b.user_id = t.user_id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 200").all();
  return rows.map((row) => serializeSupportTicket(row, true));
}

export async function replySupportTicket({ id, reply, status = "answered" }) {
  const safeStatus = ["open", "answered", "closed"].includes(status) ? status : "answered";
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE support_tickets SET admin_reply = ${reply}, status = ${safeStatus}, replied_at = NOW(), updated_at = NOW() WHERE public_id = ${id} RETURNING *`;
    return serializeSupportTicket(rows[0]);
  }
  backend.db.prepare("UPDATE support_tickets SET admin_reply = ?, status = ?, replied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?")
    .run(reply, safeStatus, id);
  return serializeSupportTicket(backend.db.prepare("SELECT * FROM support_tickets WHERE public_id = ?").get(id));
}

export const MAX_DOCUMENTS_PER_USER = 10;

function documentLimitError() {
  const error = new Error(`Limite de ${MAX_DOCUMENTS_PER_USER} documentos atingido.`);
  error.code = "DOCUMENT_LIMIT_REACHED";
  return error;
}

export async function saveHistory({ id = null, userId, title, calculationType, payload }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    if (id) {
      // Um documento aberto é atualizado no lugar; o rascunho automático nunca é sobrescrito por esse fluxo.
      const updated = await backend.sql`
        UPDATE histories
        SET title = ${title}, calculation_type = ${calculationType},
            payload = ${JSON.stringify(payload)}::jsonb, created_at = NOW()
        WHERE public_id = ${id} AND user_id = ${userId} AND calculation_type <> 'rascunho-automatico'
        RETURNING public_id AS id, title, calculation_type, payload, created_at
      `;
      if (updated.length) return { item: updated[0], created: false };
    }

    // A cota é aplicada no próprio INSERT para não depender apenas da validação da interface.
    let inserted;
    try {
      inserted = await backend.sql`
        INSERT INTO histories (public_id, user_id, title, calculation_type, payload)
        SELECT ${randomUUID()}, ${userId}, ${title}, ${calculationType}, ${JSON.stringify(payload)}::jsonb
        WHERE (
          SELECT COUNT(*) FROM histories
          WHERE user_id = ${userId} AND calculation_type <> 'rascunho-automatico'
        ) < ${MAX_DOCUMENTS_PER_USER}
        RETURNING public_id AS id, title, calculation_type, payload, created_at
      `;
    } catch (error) {
      if (error?.code === "P0001" && String(error.message).includes("document_limit_reached")) {
        throw documentLimitError();
      }
      throw error;
    }
    if (!inserted.length) throw documentLimitError();
    return { item: inserted[0], created: true };
  }

  backend.db.exec("BEGIN IMMEDIATE");
  try {
    if (id) {
      const updated = backend.db
        .prepare("UPDATE histories SET title = ?, calculation_type = ?, payload = ?, created_at = CURRENT_TIMESTAMP WHERE public_id = ? AND user_id = ? AND calculation_type <> 'rascunho-automatico'")
        .run(title, calculationType, JSON.stringify(payload), id, userId);
      if (updated.changes) {
        const item = await findHistoryById(id, userId);
        backend.db.exec("COMMIT");
        return { item, created: false };
      }
    }
    const count = Number(backend.db
      .prepare("SELECT COUNT(*) AS count FROM histories WHERE user_id = ? AND calculation_type <> 'rascunho-automatico'")
      .get(userId)?.count || 0);
    if (count >= MAX_DOCUMENTS_PER_USER) throw documentLimitError();
    const publicId = randomUUID();
    backend.db
      .prepare("INSERT INTO histories (public_id, user_id, title, calculation_type, payload) VALUES (?, ?, ?, ?, ?)")
      .run(publicId, userId, title, calculationType, JSON.stringify(payload));
    const item = await findHistoryById(publicId, userId);
    backend.db.exec("COMMIT");
    return { item, created: true };
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

// Mantém compatibilidade com chamadas antigas enquanto toda gravação passa pela mesma regra de cota.
export async function createHistory(options) {
  return (await saveHistory(options)).item;
}

export async function findHistoryById(id, userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT public_id AS id, title, calculation_type, payload, created_at
      FROM histories WHERE public_id = ${id} AND user_id = ${userId}
    `;
    return rows[0] || null;
  }
  return backend.db
    .prepare("SELECT public_id AS id, title, calculation_type, payload, created_at FROM histories WHERE public_id = ? AND user_id = ?")
    .get(id, userId) || null;
}

export async function deleteHistory(id, userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      DELETE FROM histories WHERE public_id = ${id} AND user_id = ${userId} RETURNING public_id
    `;
    return rows.length > 0;
  }
  return backend.db.prepare("DELETE FROM histories WHERE public_id = ? AND user_id = ?").run(id, userId).changes > 0;
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

export async function saveGoogleDriveConnection(userId, encryptedRefreshToken) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    await backend.sql`
      INSERT INTO google_drive_connections (user_id, encrypted_refresh_token)
      VALUES (${userId}, ${encryptedRefreshToken})
      ON CONFLICT (user_id) DO UPDATE SET
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        updated_at = NOW()
    `;
    return;
  }
  backend.db
    .prepare(`
      INSERT INTO google_drive_connections (user_id, encrypted_refresh_token)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(userId, encryptedRefreshToken);
}

export async function getGoogleDriveConnection(userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT encrypted_refresh_token, created_at, updated_at
      FROM google_drive_connections WHERE user_id = ${userId}
    `;
    return rows[0] || null;
  }
  return (
    backend.db
      .prepare("SELECT encrypted_refresh_token, created_at, updated_at FROM google_drive_connections WHERE user_id = ?")
      .get(userId) || null
  );
}

export async function deleteGoogleDriveConnection(userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      DELETE FROM google_drive_connections WHERE user_id = ${userId} RETURNING user_id
    `;
    return rows.length > 0;
  }
  return (
    backend.db
      .prepare("DELETE FROM google_drive_connections WHERE user_id = ?")
      .run(userId).changes > 0
  );
}

export function isUniqueConstraintError(error) {
  // Postgres usa o código 23505; SQLite inclui UNIQUE na mensagem.
  return error?.code === "23505" || String(error?.message || "").includes("UNIQUE");
}

export function serializeHistory(row) {
  // Postgres já entrega JSON; SQLite devolve o payload como texto.
  return { ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload };
}
