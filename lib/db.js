import { ALL_TEAM_PERMISSIONS, normalizePermissions, normalizeRole } from "./team-permissions.js";

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
      account_type TEXT NOT NULL DEFAULT 'person',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'person'`;
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
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
    CREATE TABLE IF NOT EXISTS organizations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'attendant')),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, user_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_organization_members_org ON organization_members (organization_id, status)`;
  await sql`
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id BIGSERIAL PRIMARY KEY,
      organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager', 'attendant')),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_organization_invites_active ON organization_invitations (organization_id, email, expires_at)`;

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
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'attendant')),
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

export async function createUser({ name, email, passwordHash, accountType = "person" }) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO users (name, email, password_hash, account_type)
      VALUES (${name}, ${email}, ${passwordHash}, ${accountType})
      RETURNING id, name, email, account_type
    `;
    return { ...rows[0], id: Number(rows[0].id) };
  }

  const result = backend.db
    .prepare("INSERT INTO users (name, email, password_hash, account_type) VALUES (?, ?, ?, ?)")
    .run(name, email, passwordHash, accountType);
  return { id: Number(result.lastInsertRowid), name, email, account_type: accountType, accountType };
}

export async function findUserByEmail(email) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT id, name, email, password_hash, account_type FROM users WHERE email = ${email}
    `;
    return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
  }
  return backend.db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
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

export const MAX_ORGANIZATION_MEMBERS = 10;

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
    status: row.status || "active",
    permissions: row.role === "owner" ? ALL_TEAM_PERMISSIONS : normalizePermissions(parsePermissions(row.permissions), row.role),
  };
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
      INSERT INTO organization_members (organization_id, user_id, role, permissions, status)
      VALUES (${organization.id}, ${userId}, 'owner', ${permissions}::jsonb, 'active')
      ON CONFLICT (user_id) DO UPDATE SET
        role = 'owner', permissions = EXCLUDED.permissions, status = 'active', updated_at = NOW()
    `;
    return serializeOrganizationAccess({ ...organization, organization_id: organization.id, organization_name: organization.name, role: "owner" });
  }
  backend.db.prepare("INSERT OR IGNORE INTO organizations (name, owner_user_id) VALUES (?, ?)").run(safeName, userId);
  const organization = backend.db.prepare("SELECT id, name, owner_user_id FROM organizations WHERE owner_user_id = ?").get(userId);
  backend.db.prepare(`
    INSERT INTO organization_members (organization_id, user_id, role, permissions, status)
    VALUES (?, ?, 'owner', ?, 'active')
    ON CONFLICT(user_id) DO UPDATE SET
      role = 'owner', permissions = excluded.permissions, status = 'active', updated_at = CURRENT_TIMESTAMP
  `).run(organization.id, userId, permissions);
  return serializeOrganizationAccess({ ...organization, organization_id: organization.id, organization_name: organization.name, role: "owner" });
}

export async function findOrganizationAccess(userId) {
  const backend = await getBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT m.organization_id, o.name AS organization_name, o.owner_user_id,
             m.role, m.permissions, m.status
      FROM organization_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId} AND m.status = 'active'
      LIMIT 1
    `;
    return serializeOrganizationAccess(rows[0]);
  }
  return serializeOrganizationAccess(backend.db.prepare(`
    SELECT m.organization_id, o.name AS organization_name, o.owner_user_id,
           m.role, m.permissions, m.status
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
      SELECT m.user_id AS id, u.name, u.email, m.role, m.permissions, m.status, m.created_at
      FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name
    `;
    const invitations = await backend.sql`
      SELECT id, email, role, permissions, expires_at, created_at
      FROM organization_invitations
      WHERE organization_id = ${organizationId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    return {
      members: members.map((row) => ({ ...row, id: Number(row.id), permissions: row.role === "owner" ? ALL_TEAM_PERMISSIONS : parsePermissions(row.permissions) })),
      invitations: invitations.map((row) => ({ ...row, id: Number(row.id), permissions: parsePermissions(row.permissions) })),
    };
  }
  const members = backend.db.prepare(`
    SELECT m.user_id AS id, u.name, u.email, m.role, m.permissions, m.status, m.created_at
    FROM organization_members m JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name
  `).all(organizationId).map((row) => ({ ...row, id: Number(row.id), permissions: row.role === "owner" ? ALL_TEAM_PERMISSIONS : parsePermissions(row.permissions) }));
  const invitations = backend.db.prepare(`
    SELECT id, email, role, permissions, expires_at, created_at
    FROM organization_invitations
    WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
  `).all(organizationId).map((row) => ({ ...row, id: Number(row.id), permissions: parsePermissions(row.permissions) }));
  return { members, invitations };
}

export async function createOrganizationInvitation({ organizationId, email, role, permissions, tokenHash, invitedBy, expiresAt }) {
  const backend = await getBackend();
  const safeRole = normalizeRole(role);
  const safePermissions = normalizePermissions(permissions, safeRole);
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
      INSERT INTO organization_invitations (organization_id, email, role, permissions, token_hash, invited_by, expires_at)
      VALUES (${organizationId}, ${email}, ${safeRole}, ${serialized}::jsonb, ${tokenHash}, ${invitedBy}, ${expiresAt.toISOString()})
      RETURNING id, email, role, permissions, expires_at, created_at
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
    INSERT INTO organization_invitations (organization_id, email, role, permissions, token_hash, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(organizationId, email, safeRole, serialized, tokenHash, invitedBy, expiresAt.toISOString());
  return { id: Number(result.lastInsertRowid), email, role: safeRole, permissions: safePermissions, expires_at: expiresAt.toISOString() };
}

export async function findOrganizationInvitation(tokenHash) {
  const backend = await getBackend();
  const query = backend.type === "postgres"
    ? await backend.sql`
        SELECT i.id, i.organization_id, i.email, i.role, i.permissions, i.expires_at,
               o.name AS organization_name, o.owner_user_id, u.name AS inviter_name
        FROM organization_invitations i
        JOIN organizations o ON o.id = i.organization_id
        JOIN users u ON u.id = i.invited_by
        WHERE i.token_hash = ${tokenHash} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
      `
    : [backend.db.prepare(`
        SELECT i.id, i.organization_id, i.email, i.role, i.permissions, i.expires_at,
               o.name AS organization_name, o.owner_user_id, u.name AS inviter_name
        FROM organization_invitations i
        JOIN organizations o ON o.id = i.organization_id
        JOIN users u ON u.id = i.invited_by
        WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND datetime(i.expires_at) > CURRENT_TIMESTAMP
      `).get(tokenHash)].filter(Boolean);
  const row = query[0];
  return row ? { ...row, id: Number(row.id), organization_id: Number(row.organization_id), owner_user_id: Number(row.owner_user_id), permissions: parsePermissions(row.permissions) } : null;
}

export async function acceptOrganizationInvitation({ tokenHash, userId, email }) {
  const invitation = await findOrganizationInvitation(tokenHash);
  if (!invitation || invitation.email.toLowerCase() !== String(email).toLowerCase()) return null;
  const backend = await getBackend();
  const serialized = JSON.stringify(normalizePermissions(invitation.permissions, invitation.role));
  try {
    if (backend.type === "postgres") {
      const rows = await backend.sql`
        INSERT INTO organization_members (organization_id, user_id, role, permissions, status)
        VALUES (${invitation.organization_id}, ${userId}, ${invitation.role}, ${serialized}::jsonb, 'active')
        ON CONFLICT (user_id) DO NOTHING
        RETURNING user_id
      `;
      if (!rows.length) return null;
      await backend.sql`UPDATE organization_invitations SET accepted_at = NOW() WHERE id = ${invitation.id} AND accepted_at IS NULL`;
    } else {
      const result = backend.db.prepare(`
        INSERT OR IGNORE INTO organization_members (organization_id, user_id, role, permissions, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(invitation.organization_id, userId, invitation.role, serialized);
      if (!result.changes) return null;
      backend.db.prepare("UPDATE organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND accepted_at IS NULL").run(invitation.id);
    }
    return findOrganizationAccess(userId);
  } catch {
    return null;
  }
}

export async function updateOrganizationMember({ organizationId, userId, role, permissions, status = "active" }) {
  const backend = await getBackend();
  const safeRole = normalizeRole(role);
  const serialized = JSON.stringify(normalizePermissions(permissions, safeRole));
  const safeStatus = status === "suspended" ? "suspended" : "active";
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      UPDATE organization_members SET role = ${safeRole}, permissions = ${serialized}::jsonb,
        status = ${safeStatus}, updated_at = NOW()
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND role <> 'owner'
      RETURNING user_id AS id, role, permissions, status
    `;
    return rows[0] ? { ...rows[0], id: Number(rows[0].id), permissions: parsePermissions(rows[0].permissions) } : null;
  }
  const result = backend.db.prepare(`
    UPDATE organization_members SET role = ?, permissions = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE organization_id = ? AND user_id = ? AND role <> 'owner'
  `).run(safeRole, serialized, safeStatus, organizationId, userId);
  return result.changes ? { id: userId, role: safeRole, permissions: JSON.parse(serialized), status: safeStatus } : null;
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
      RETURNING id, title, calculation_type, payload, created_at
    `;
    if (updated.length) return updated[0];
    const inserted = await backend.sql`
      INSERT INTO histories (user_id, title, calculation_type, payload)
      VALUES (${userId}, ${title}, 'rascunho-automatico', ${JSON.stringify(candidates[0].payload)}::jsonb)
      RETURNING id, title, calculation_type, payload, created_at
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
    const existing = backend.db.prepare("SELECT id FROM histories WHERE user_id = ? AND calculation_type = 'rascunho-automatico' ORDER BY id DESC LIMIT 1").get(userId);
    const result = existing
      ? (backend.db.prepare("UPDATE histories SET title = ?, payload = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?").run(title, JSON.stringify(current.payload), existing.id), { lastInsertRowid: existing.id })
      : backend.db.prepare("INSERT INTO histories (user_id, title, calculation_type, payload) VALUES (?, ?, 'rascunho-automatico', ?)").run(userId, title, JSON.stringify(current.payload));
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

// Métricas agregadas para moderação; nenhuma consulta retorna dados financeiros pessoais.
export async function getAdminOverview() {
  const backend = await getBackend();
  const sinceDay = Date.now() - 86_400_000;
  const sinceTenMinutes = Date.now() - 600_000;
  if (backend.type === "postgres") {
    const [users, histories, workspaces, traffic] = await Promise.all([
      backend.sql`SELECT COUNT(*)::int AS count FROM users`,
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
    users: scalar("SELECT COUNT(*) AS value FROM users"),
    histories: scalar("SELECT COUNT(*) AS value FROM histories"),
    workspaces: scalar("SELECT COUNT(*) AS value FROM workspaces"),
    requests_day: scalar("SELECT COALESCE(SUM(request_count), 0) AS value FROM rate_limits WHERE window_start >= ?", sinceDay),
    requests_ten_minutes: scalar("SELECT COALESCE(SUM(request_count), 0) AS value FROM rate_limits WHERE window_start >= ?", sinceTenMinutes),
    peak_per_identity: scalar("SELECT COALESCE(MAX(request_count), 0) AS value FROM rate_limits WHERE window_start >= ?", sinceDay),
  };
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
        WHERE id = ${id} AND user_id = ${userId} AND calculation_type <> 'rascunho-automatico'
        RETURNING id, title, calculation_type, payload, created_at
      `;
      if (updated.length) return { item: updated[0], created: false };
    }

    // A cota é aplicada no próprio INSERT para não depender apenas da validação da interface.
    let inserted;
    try {
      inserted = await backend.sql`
        INSERT INTO histories (user_id, title, calculation_type, payload)
        SELECT ${userId}, ${title}, ${calculationType}, ${JSON.stringify(payload)}::jsonb
        WHERE (
          SELECT COUNT(*) FROM histories
          WHERE user_id = ${userId} AND calculation_type <> 'rascunho-automatico'
        ) < ${MAX_DOCUMENTS_PER_USER}
        RETURNING id, title, calculation_type, payload, created_at
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
        .prepare("UPDATE histories SET title = ?, calculation_type = ?, payload = ?, created_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND calculation_type <> 'rascunho-automatico'")
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
    const result = backend.db
      .prepare("INSERT INTO histories (user_id, title, calculation_type, payload) VALUES (?, ?, ?, ?)")
      .run(userId, title, calculationType, JSON.stringify(payload));
    const item = await findHistoryById(Number(result.lastInsertRowid), userId);
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
