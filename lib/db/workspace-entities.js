import { randomUUID } from "node:crypto";

const CLIENT_STATUSES = new Set(["active", "lead", "inactive"]);
const TASK_STATUSES = new Set(["todo", "doing", "done"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);

function cleanText(value, maxLength) {
  return String(value || "").normalize("NFKC").trim().slice(0, maxLength);
}

function cleanId(value) {
  const id = cleanText(value, 120);
  return id || randomUUID();
}

function cleanIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cleanDueDate(value) {
  const date = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function uniqueByPublicId(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.public_id)) return false;
    seen.add(item.public_id);
    return true;
  });
}

function normalizeClients(value) {
  if (!Array.isArray(value)) return null;
  return uniqueByPublicId(value.slice(0, 2_000).map((client) => ({
    public_id: cleanId(client?.id),
    name: cleanText(client?.name, 100),
    phone: cleanText(client?.phone, 24),
    email: cleanText(client?.email, 160),
    status: CLIENT_STATUSES.has(client?.status) ? client.status : "active",
    notes: cleanText(client?.notes, 240),
    original_created_at: cleanIsoDate(client?.createdAt),
  })).filter((client) => client.name));
}

function normalizeTasks(value) {
  if (!Array.isArray(value)) return null;
  return uniqueByPublicId(value.slice(0, 4_000).map((task) => ({
    public_id: cleanId(task?.id),
    customer_public_id: cleanText(task?.clientId, 120) || null,
    title: cleanText(task?.title, 120),
    due_date: cleanDueDate(task?.dueDate),
    priority: TASK_PRIORITIES.has(task?.priority) ? task.priority : "medium",
    status: TASK_STATUSES.has(task?.status) ? task.status : "todo",
    original_created_at: cleanIsoDate(task?.createdAt),
    completed_at: cleanIsoDate(task?.completedAt),
  })).filter((task) => task.title));
}

function asIso(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeCustomer(row) {
  return {
    id: row.public_id,
    name: row.name,
    phone: row.phone || "",
    email: row.email || "",
    status: row.status,
    notes: row.notes || "",
    createdAt: asIso(row.original_created_at || row.created_at),
  };
}

function serializeTask(row) {
  return {
    id: row.public_id,
    clientId: row.customer_public_id || "",
    title: row.title,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : "",
    priority: row.priority,
    status: row.status,
    createdAt: asIso(row.original_created_at || row.created_at),
    completedAt: asIso(row.completed_at),
  };
}

export async function listWorkspaceCustomers(backend, ownerUserId, organizationId) {
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT public_id, name, phone, email, status, notes, original_created_at, created_at
      FROM customers
      WHERE owner_user_id = ${ownerUserId}
        AND organization_id IS NOT DISTINCT FROM ${organizationId}
      ORDER BY created_at, id
    `;
    return rows.map(serializeCustomer);
  }
  return backend.db.prepare(`
    SELECT public_id, name, phone, email, status, notes, original_created_at, created_at
    FROM customers
    WHERE owner_user_id = ? AND organization_id IS ?
    ORDER BY created_at, id
  `).all(ownerUserId, organizationId).map(serializeCustomer);
}

export async function listWorkspaceTasks(backend, ownerUserId, organizationId) {
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT t.public_id, c.public_id AS customer_public_id, t.title, t.due_date,
             t.priority, t.status, t.original_created_at, t.completed_at, t.created_at
      FROM operational_tasks t
      LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.owner_user_id = ${ownerUserId}
        AND t.organization_id IS NOT DISTINCT FROM ${organizationId}
      ORDER BY t.created_at, t.id
    `;
    return rows.map(serializeTask);
  }
  return backend.db.prepare(`
    SELECT t.public_id, c.public_id AS customer_public_id, t.title, t.due_date,
           t.priority, t.status, t.original_created_at, t.completed_at, t.created_at
    FROM operational_tasks t
    LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.owner_user_id = ? AND t.organization_id IS ?
    ORDER BY t.created_at, t.id
  `).all(ownerUserId, organizationId).map(serializeTask);
}

export async function hydrateWorkspaceEntities(backend, workspace) {
  if (!workspace) return null;
  const clientsMigrated = Boolean(workspace.clients_relational_at);
  const tasksMigrated = Boolean(workspace.tasks_relational_at);
  const [clients, tasks] = await Promise.all([
    clientsMigrated ? listWorkspaceCustomers(backend, workspace.user_id, workspace.organization_id) : null,
    tasksMigrated ? listWorkspaceTasks(backend, workspace.user_id, workspace.organization_id) : null,
  ]);
  const { clients_relational_at: _clientsMarker, tasks_relational_at: _tasksMarker, ...cleanWorkspace } = workspace;
  return {
    ...cleanWorkspace,
    payload: {
      ...cleanWorkspace.payload,
      ...(clientsMigrated ? { clients } : {}),
      ...(tasksMigrated ? { tasks } : {}),
    },
  };
}

async function syncPostgres(backend, { ownerUserId, organizationId, clients, tasks }) {
  const queries = [];
  if (clients) {
    const serializedClients = JSON.stringify(clients);
    queries.push(backend.sql`
      INSERT INTO customers (
        public_id, owner_user_id, organization_id, name, phone, email, status, notes, original_created_at
      )
      SELECT input.public_id, ${ownerUserId}, ${organizationId}, input.name, input.phone,
             input.email, input.status, input.notes, input.original_created_at::timestamptz
      FROM jsonb_to_recordset(${serializedClients}::jsonb) AS input(
        public_id text, name text, phone text, email text, status text, notes text, original_created_at text
      )
      ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        original_created_at = COALESCE(customers.original_created_at, EXCLUDED.original_created_at),
        updated_at = NOW()
      WHERE customers.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
    `);
  }
  if (tasks) {
    const serializedTasks = JSON.stringify(tasks);
    queries.push(backend.sql`
      INSERT INTO operational_tasks (
        public_id, owner_user_id, organization_id, customer_id, title, due_date,
        priority, status, original_created_at, completed_at
      )
      SELECT input.public_id, ${ownerUserId}, ${organizationId}, customer.id, input.title,
             input.due_date::date, input.priority, input.status,
             input.original_created_at::timestamptz, input.completed_at::timestamptz
      FROM jsonb_to_recordset(${serializedTasks}::jsonb) AS input(
        public_id text, customer_public_id text, title text, due_date text,
        priority text, status text, original_created_at text, completed_at text
      )
      LEFT JOIN customers customer
        ON customer.owner_user_id = ${ownerUserId}
       AND customer.organization_id IS NOT DISTINCT FROM ${organizationId}
       AND customer.public_id = input.customer_public_id
      ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        title = EXCLUDED.title,
        due_date = EXCLUDED.due_date,
        priority = EXCLUDED.priority,
        status = EXCLUDED.status,
        original_created_at = COALESCE(operational_tasks.original_created_at, EXCLUDED.original_created_at),
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW()
      WHERE operational_tasks.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
    `);
    queries.push(backend.sql`
      DELETE FROM operational_tasks task
      WHERE task.owner_user_id = ${ownerUserId}
        AND task.organization_id IS NOT DISTINCT FROM ${organizationId}
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(${serializedTasks}::jsonb) AS input(public_id text)
          WHERE input.public_id = task.public_id
        )
    `);
  }
  if (clients) {
    const serializedClients = JSON.stringify(clients);
    queries.push(backend.sql`
      DELETE FROM customers customer
      WHERE customer.owner_user_id = ${ownerUserId}
        AND customer.organization_id IS NOT DISTINCT FROM ${organizationId}
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(${serializedClients}::jsonb) AS input(public_id text)
          WHERE input.public_id = customer.public_id
        )
    `);
  }
  queries.push(backend.sql`
    UPDATE workspaces SET
      clients_relational_at = CASE WHEN ${Boolean(clients)} THEN COALESCE(clients_relational_at, NOW()) ELSE clients_relational_at END,
      tasks_relational_at = CASE WHEN ${Boolean(tasks)} THEN COALESCE(tasks_relational_at, NOW()) ELSE tasks_relational_at END
    WHERE user_id = ${ownerUserId} AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `);
  await backend.sql.transaction(queries);
}

function syncSqlite(backend, { ownerUserId, organizationId, clients, tasks }) {
  const { db } = backend;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (clients) {
      const upsert = db.prepare(`
        INSERT INTO customers (public_id, owner_user_id, organization_id, name, phone, email, status, notes, original_created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, public_id) DO UPDATE SET
          name = excluded.name, phone = excluded.phone, email = excluded.email,
          status = excluded.status, notes = excluded.notes,
          original_created_at = COALESCE(customers.original_created_at, excluded.original_created_at),
          updated_at = CURRENT_TIMESTAMP
        WHERE customers.organization_id IS excluded.organization_id
      `);
      for (const client of clients) {
        upsert.run(client.public_id, ownerUserId, organizationId, client.name, client.phone, client.email,
          client.status, client.notes, client.original_created_at);
      }
    }
    if (tasks) {
      const findCustomer = db.prepare(`
        SELECT id FROM customers
        WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?
      `);
      const upsert = db.prepare(`
        INSERT INTO operational_tasks (
          public_id, owner_user_id, organization_id, customer_id, title, due_date,
          priority, status, original_created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, public_id) DO UPDATE SET
          customer_id = excluded.customer_id, title = excluded.title, due_date = excluded.due_date,
          priority = excluded.priority, status = excluded.status,
          original_created_at = COALESCE(operational_tasks.original_created_at, excluded.original_created_at),
          completed_at = excluded.completed_at, updated_at = CURRENT_TIMESTAMP
        WHERE operational_tasks.organization_id IS excluded.organization_id
      `);
      for (const task of tasks) {
        const customerId = task.customer_public_id
          ? findCustomer.get(ownerUserId, organizationId, task.customer_public_id)?.id || null
          : null;
        upsert.run(task.public_id, ownerUserId, organizationId, customerId, task.title, task.due_date,
          task.priority, task.status, task.original_created_at, task.completed_at);
      }
      const allowed = new Set(tasks.map((task) => task.public_id));
      const current = db.prepare("SELECT public_id FROM operational_tasks WHERE owner_user_id = ? AND organization_id IS ?").all(ownerUserId, organizationId);
      const remove = db.prepare("DELETE FROM operational_tasks WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      for (const row of current) if (!allowed.has(row.public_id)) remove.run(ownerUserId, organizationId, row.public_id);
    }
    if (clients) {
      const allowed = new Set(clients.map((client) => client.public_id));
      const current = db.prepare("SELECT public_id FROM customers WHERE owner_user_id = ? AND organization_id IS ?").all(ownerUserId, organizationId);
      const remove = db.prepare("DELETE FROM customers WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      for (const row of current) if (!allowed.has(row.public_id)) remove.run(ownerUserId, organizationId, row.public_id);
    }
    db.prepare(`
      UPDATE workspaces SET
        clients_relational_at = CASE WHEN ? THEN COALESCE(clients_relational_at, CURRENT_TIMESTAMP) ELSE clients_relational_at END,
        tasks_relational_at = CASE WHEN ? THEN COALESCE(tasks_relational_at, CURRENT_TIMESTAMP) ELSE tasks_relational_at END
      WHERE user_id = ? AND organization_id IS ?
    `).run(clients ? 1 : 0, tasks ? 1 : 0, ownerUserId, organizationId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function syncWorkspaceEntities(backend, { ownerUserId, organizationId, payload }) {
  const clients = normalizeClients(payload?.clients);
  const tasks = normalizeTasks(payload?.tasks);
  if (!clients && !tasks) return;
  if (backend.type === "postgres") {
    await syncPostgres(backend, { ownerUserId, organizationId, clients, tasks });
    return;
  }
  syncSqlite(backend, { ownerUserId, organizationId, clients, tasks });
}
