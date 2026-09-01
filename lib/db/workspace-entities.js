import { randomUUID } from "node:crypto";

const CLIENT_STATUSES = new Set(["active", "lead", "inactive"]);
const TASK_STATUSES = new Set(["todo", "doing", "done"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);
const DELIVERY_DIRECTIONS = new Set(["entrada", "saida"]);
const DELIVERY_STATUSES = new Set(["preparando", "em-transito", "entregue", "cancelada"]);

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

function cleanUuid(value) {
  const id = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
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

function normalizeDeliveries(value) {
  if (!Array.isArray(value)) return null;
  return uniqueByPublicId(value.slice(0, 4_000).map((delivery) => ({
    public_id: cleanId(delivery?.id),
    customer_public_id: cleanText(delivery?.clientId, 120) || null,
    order_public_id: cleanUuid(delivery?.orderId),
    description: cleanText(delivery?.description, 160),
    partner: cleanText(delivery?.partner, 120),
    direction: DELIVERY_DIRECTIONS.has(delivery?.direction) ? delivery.direction : "saida",
    planned_for: cleanDueDate(delivery?.date),
    status: DELIVERY_STATUSES.has(delivery?.status) ? delivery.status : "preparando",
    tracking_code: cleanText(delivery?.tracking, 120),
  })).filter((delivery) => delivery.description || delivery.partner || delivery.tracking_code));
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

function serializeDelivery(row) {
  return {
    id: row.public_id,
    clientId: row.customer_public_id || "",
    orderId: row.order_public_id || "",
    description: row.description || "",
    partner: row.partner || "",
    direction: row.direction,
    date: row.planned_for ? String(row.planned_for).slice(0, 10) : "",
    status: row.status,
    tracking: row.tracking_code || "",
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

export async function listWorkspaceDeliveries(backend, ownerUserId, organizationId) {
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      SELECT delivery.public_id, customer.public_id AS customer_public_id,
             inventory_order.public_id::text AS order_public_id, delivery.description,
             delivery.partner, delivery.direction, delivery.planned_for,
             delivery.status, delivery.tracking_code
      FROM operational_deliveries delivery
      LEFT JOIN customers customer ON customer.id = delivery.customer_id
      LEFT JOIN inventory_orders inventory_order ON inventory_order.id = delivery.inventory_order_id
      WHERE delivery.owner_user_id = ${ownerUserId}
        AND delivery.organization_id IS NOT DISTINCT FROM ${organizationId}
      ORDER BY delivery.created_at, delivery.id
    `;
    return rows.map(serializeDelivery);
  }
  return backend.db.prepare(`
    SELECT delivery.public_id, customer.public_id AS customer_public_id,
           delivery.order_public_id, delivery.description,
           delivery.partner, delivery.direction, delivery.planned_for,
           delivery.status, delivery.tracking_code
    FROM operational_deliveries delivery
    LEFT JOIN customers customer ON customer.id = delivery.customer_id
    WHERE delivery.owner_user_id = ? AND delivery.organization_id IS ?
    ORDER BY delivery.created_at, delivery.id
  `).all(ownerUserId, organizationId).map(serializeDelivery);
}

export async function hydrateWorkspaceEntities(backend, workspace) {
  if (!workspace) return null;
  const clientsMigrated = Boolean(workspace.clients_relational_at);
  const tasksMigrated = Boolean(workspace.tasks_relational_at);
  const deliveriesMigrated = Boolean(workspace.deliveries_relational_at);
  const [clients, tasks, deliveries] = await Promise.all([
    clientsMigrated ? listWorkspaceCustomers(backend, workspace.user_id, workspace.organization_id) : null,
    tasksMigrated ? listWorkspaceTasks(backend, workspace.user_id, workspace.organization_id) : null,
    deliveriesMigrated ? listWorkspaceDeliveries(backend, workspace.user_id, workspace.organization_id) : null,
  ]);
  const {
    clients_relational_at: _clientsMarker,
    tasks_relational_at: _tasksMarker,
    deliveries_relational_at: _deliveriesMarker,
    ...cleanWorkspace
  } = workspace;
  return {
    ...cleanWorkspace,
    payload: {
      ...cleanWorkspace.payload,
      ...(clientsMigrated ? { clients } : {}),
      ...(tasksMigrated ? { tasks } : {}),
      ...(deliveriesMigrated ? {
        inventoryState: { ...(cleanWorkspace.payload?.inventoryState || {}), deliveries },
      } : {}),
    },
  };
}

async function syncPostgres(backend, { ownerUserId, organizationId, clients, tasks, deliveries }) {
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
  if (deliveries) {
    const serializedDeliveries = JSON.stringify(deliveries);
    queries.push(backend.sql`
      INSERT INTO outbox_events (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
      SELECT gen_random_uuid(), ${organizationId}, 'operational_delivery', input.public_id,
             CASE WHEN current_delivery.id IS NULL THEN 'delivery.created' ELSE 'delivery.status_changed' END,
             'delivery:' || input.public_id || ':' || COALESCE(current_delivery.updated_at::text, 'new') || ':' || COALESCE(current_delivery.status, 'new') || '>' || input.status,
             jsonb_build_object('previousStatus', current_delivery.status, 'status', input.status)
      FROM jsonb_to_recordset(${serializedDeliveries}::jsonb) AS input(public_id text, status text)
      LEFT JOIN operational_deliveries current_delivery
        ON current_delivery.owner_user_id = ${ownerUserId}
       AND current_delivery.organization_id IS NOT DISTINCT FROM ${organizationId}
       AND current_delivery.public_id = input.public_id
      WHERE current_delivery.id IS NULL OR current_delivery.status <> input.status
      ON CONFLICT (event_type, dedupe_key) DO NOTHING
    `);
    queries.push(backend.sql`
      INSERT INTO operational_deliveries (
        public_id, owner_user_id, organization_id, customer_id, inventory_order_id,
        description, partner, direction, planned_for, status, tracking_code, delivered_at
      )
      SELECT input.public_id, ${ownerUserId}, ${organizationId}, customer.id, inventory_order.id,
             input.description, input.partner, input.direction, input.planned_for::date,
             input.status, input.tracking_code,
             CASE WHEN input.status = 'entregue' THEN NOW() ELSE NULL END
      FROM jsonb_to_recordset(${serializedDeliveries}::jsonb) AS input(
        public_id text, customer_public_id text, order_public_id text, description text,
        partner text, direction text, planned_for text, status text, tracking_code text
      )
      LEFT JOIN customers customer
        ON customer.owner_user_id = ${ownerUserId}
       AND customer.organization_id IS NOT DISTINCT FROM ${organizationId}
       AND customer.public_id = input.customer_public_id
      LEFT JOIN inventory_orders inventory_order
        ON inventory_order.public_id::text = input.order_public_id
       AND inventory_order.organization_id IS NOT DISTINCT FROM ${organizationId}
      ON CONFLICT (owner_user_id, public_id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        inventory_order_id = EXCLUDED.inventory_order_id,
        description = EXCLUDED.description,
        partner = EXCLUDED.partner,
        direction = EXCLUDED.direction,
        planned_for = EXCLUDED.planned_for,
        status = EXCLUDED.status,
        tracking_code = EXCLUDED.tracking_code,
        delivered_at = CASE
          WHEN EXCLUDED.status = 'entregue' THEN COALESCE(operational_deliveries.delivered_at, NOW())
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE operational_deliveries.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
    `);
    queries.push(backend.sql`
      DELETE FROM operational_deliveries delivery
      WHERE delivery.owner_user_id = ${ownerUserId}
        AND delivery.organization_id IS NOT DISTINCT FROM ${organizationId}
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(${serializedDeliveries}::jsonb) AS input(public_id text)
          WHERE input.public_id = delivery.public_id
        )
    `);
  }
  queries.push(backend.sql`
    UPDATE workspaces SET
      clients_relational_at = CASE WHEN ${Boolean(clients)} THEN COALESCE(clients_relational_at, NOW()) ELSE clients_relational_at END,
      tasks_relational_at = CASE WHEN ${Boolean(tasks)} THEN COALESCE(tasks_relational_at, NOW()) ELSE tasks_relational_at END,
      deliveries_relational_at = CASE WHEN ${Boolean(deliveries)} THEN COALESCE(deliveries_relational_at, NOW()) ELSE deliveries_relational_at END
    WHERE user_id = ${ownerUserId} AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `);
  await backend.sql.transaction(queries);
}

function syncSqlite(backend, { ownerUserId, organizationId, clients, tasks, deliveries }) {
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
    if (deliveries) {
      const findCustomer = db.prepare("SELECT id FROM customers WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      const findDelivery = db.prepare("SELECT status, updated_at FROM operational_deliveries WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      const insertEvent = db.prepare(`INSERT OR IGNORE INTO outbox_events
        (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
        VALUES (?, ?, 'operational_delivery', ?, ?, ?, ?)`);
      const upsert = db.prepare(`
        INSERT INTO operational_deliveries (
          public_id, owner_user_id, organization_id, customer_id, order_public_id,
          description, partner, direction, planned_for, status, tracking_code, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, public_id) DO UPDATE SET
          customer_id = excluded.customer_id, order_public_id = excluded.order_public_id,
          description = excluded.description, partner = excluded.partner, direction = excluded.direction,
          planned_for = excluded.planned_for, status = excluded.status, tracking_code = excluded.tracking_code,
          delivered_at = CASE WHEN excluded.status = 'entregue' THEN COALESCE(operational_deliveries.delivered_at, CURRENT_TIMESTAMP) ELSE NULL END,
          updated_at = CURRENT_TIMESTAMP
        WHERE operational_deliveries.organization_id IS excluded.organization_id
      `);
      for (const delivery of deliveries) {
        const currentDelivery = findDelivery.get(ownerUserId, organizationId, delivery.public_id);
        if (!currentDelivery || currentDelivery.status !== delivery.status) {
          const eventType = currentDelivery ? "delivery.status_changed" : "delivery.created";
          insertEvent.run(randomUUID(), organizationId, delivery.public_id, eventType,
            `delivery:${delivery.public_id}:${currentDelivery?.updated_at || "new"}:${currentDelivery?.status || "new"}>${delivery.status}`,
            JSON.stringify({ previousStatus: currentDelivery?.status || null, status: delivery.status }));
        }
        const customerId = delivery.customer_public_id
          ? findCustomer.get(ownerUserId, organizationId, delivery.customer_public_id)?.id || null
          : null;
        upsert.run(delivery.public_id, ownerUserId, organizationId, customerId, delivery.order_public_id,
          delivery.description, delivery.partner, delivery.direction, delivery.planned_for,
          delivery.status, delivery.tracking_code, delivery.status === "entregue" ? new Date().toISOString() : null);
      }
      const allowed = new Set(deliveries.map((delivery) => delivery.public_id));
      const current = db.prepare("SELECT public_id FROM operational_deliveries WHERE owner_user_id = ? AND organization_id IS ?").all(ownerUserId, organizationId);
      const remove = db.prepare("DELETE FROM operational_deliveries WHERE owner_user_id = ? AND organization_id IS ? AND public_id = ?");
      for (const row of current) if (!allowed.has(row.public_id)) remove.run(ownerUserId, organizationId, row.public_id);
    }
    db.prepare(`
      UPDATE workspaces SET
        clients_relational_at = CASE WHEN ? THEN COALESCE(clients_relational_at, CURRENT_TIMESTAMP) ELSE clients_relational_at END,
        tasks_relational_at = CASE WHEN ? THEN COALESCE(tasks_relational_at, CURRENT_TIMESTAMP) ELSE tasks_relational_at END,
        deliveries_relational_at = CASE WHEN ? THEN COALESCE(deliveries_relational_at, CURRENT_TIMESTAMP) ELSE deliveries_relational_at END
      WHERE user_id = ? AND organization_id IS ?
    `).run(clients ? 1 : 0, tasks ? 1 : 0, deliveries ? 1 : 0, ownerUserId, organizationId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function syncWorkspaceEntities(backend, { ownerUserId, organizationId, payload }) {
  const clients = normalizeClients(payload?.clients);
  const tasks = normalizeTasks(payload?.tasks);
  const deliveries = normalizeDeliveries(payload?.inventoryState?.deliveries);
  if (!clients && !tasks && !deliveries) return;
  if (backend.type === "postgres") {
    await syncPostgres(backend, { ownerUserId, organizationId, clients, tasks, deliveries });
    return;
  }
  syncSqlite(backend, { ownerUserId, organizationId, clients, tasks, deliveries });
}
