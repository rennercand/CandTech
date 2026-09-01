import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";

function deserializeBody(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function claimResult(row, claimed = false) {
  if (!row) return { state: "pending" };
  if (claimed) return { state: "claimed" };
  if (row.status === "completed") {
    return { state: "replay", status: Number(row.response_status), body: deserializeBody(row.response_body) };
  }
  return { state: "pending" };
}

export async function claimIdempotency({ userId, organizationId = null, operation, keyHash, requestHash, ttlHours = 24 }) {
  const backend = await getDatabaseBackend();
  if (backend.type === "postgres") {
    const inserted = await backend.sql`
      INSERT INTO idempotency_keys (user_id, organization_id, operation, key_hash, request_hash, locked_until, expires_at)
      VALUES (${userId}, ${organizationId}, ${operation}, ${keyHash}, ${requestHash}, NOW() + INTERVAL '2 minutes', NOW() + (${ttlHours} * INTERVAL '1 hour'))
      ON CONFLICT (user_id, operation, key_hash) DO NOTHING
      RETURNING *
    `;
    if (inserted.length) return claimResult(inserted[0], true);
    const existing = await backend.sql`
      SELECT * FROM idempotency_keys WHERE user_id = ${userId} AND operation = ${operation} AND key_hash = ${keyHash}
    `;
    const row = existing[0];
    if (!row || row.request_hash !== requestHash) return { state: "conflict" };
    if (row.status === "completed") return claimResult(row);
    const reclaimed = await backend.sql`
      UPDATE idempotency_keys
      SET status = 'pending', locked_until = NOW() + INTERVAL '2 minutes', expires_at = NOW() + (${ttlHours} * INTERVAL '1 hour')
      WHERE id = ${row.id} AND request_hash = ${requestHash} AND (status = 'failed' OR locked_until <= NOW() OR expires_at <= NOW())
      RETURNING *
    `;
    return reclaimed.length ? claimResult(reclaimed[0], true) : { state: "pending" };
  }

  const now = new Date();
  const lockedUntil = new Date(now.getTime() + 120_000).toISOString();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = backend.db.prepare(`
      INSERT OR IGNORE INTO idempotency_keys
        (user_id, organization_id, operation, key_hash, request_hash, locked_until, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, organizationId, operation, keyHash, requestHash, lockedUntil, expiresAt);
    if (inserted.changes) {
      backend.db.exec("COMMIT");
      return { state: "claimed" };
    }
    const row = backend.db.prepare("SELECT * FROM idempotency_keys WHERE user_id = ? AND operation = ? AND key_hash = ?")
      .get(userId, operation, keyHash);
    if (!row || row.request_hash !== requestHash) {
      backend.db.exec("COMMIT");
      return { state: "conflict" };
    }
    if (row.status === "completed") {
      backend.db.exec("COMMIT");
      return claimResult(row);
    }
    const reclaimed = backend.db.prepare(`
      UPDATE idempotency_keys SET status = 'pending', locked_until = ?, expires_at = ?
      WHERE id = ? AND request_hash = ? AND (status = 'failed' OR locked_until <= ? OR expires_at <= ?)
    `).run(lockedUntil, expiresAt, row.id, requestHash, now.toISOString(), now.toISOString());
    backend.db.exec("COMMIT");
    return reclaimed.changes ? { state: "claimed" } : { state: "pending" };
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function completeIdempotency({ userId, operation, keyHash, requestHash, status, body }) {
  const backend = await getDatabaseBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      UPDATE idempotency_keys SET status = 'completed', response_status = ${status}, response_body = ${JSON.stringify(body)}::jsonb, completed_at = NOW()
      WHERE user_id = ${userId} AND operation = ${operation} AND key_hash = ${keyHash} AND request_hash = ${requestHash} AND status = 'pending'
      RETURNING id
    `;
    return Boolean(rows.length);
  }
  return Boolean(backend.db.prepare(`
    UPDATE idempotency_keys SET status = 'completed', response_status = ?, response_body = ?, completed_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND operation = ? AND key_hash = ? AND request_hash = ? AND status = 'pending'
  `).run(status, JSON.stringify(body), userId, operation, keyHash, requestHash).changes);
}

export async function failIdempotency({ userId, operation, keyHash, requestHash }) {
  const backend = await getDatabaseBackend();
  if (backend.type === "postgres") {
    await backend.sql`
      UPDATE idempotency_keys SET status = 'failed', locked_until = NOW()
      WHERE user_id = ${userId} AND operation = ${operation} AND key_hash = ${keyHash} AND request_hash = ${requestHash} AND status = 'pending'
    `;
    return;
  }
  backend.db.prepare(`
    UPDATE idempotency_keys SET status = 'failed', locked_until = CURRENT_TIMESTAMP
    WHERE user_id = ? AND operation = ? AND key_hash = ? AND request_hash = ? AND status = 'pending'
  `).run(userId, operation, keyHash, requestHash);
}

export async function enqueueOutboxEvent({ organizationId = null, aggregateType, aggregateId, eventType, dedupeKey = null, payload = {} }) {
  const backend = await getDatabaseBackend();
  const publicId = randomUUID();
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      INSERT INTO outbox_events (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
      VALUES (${publicId}, ${organizationId}, ${aggregateType}, ${aggregateId}, ${eventType}, ${dedupeKey}, ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT (event_type, dedupe_key) DO NOTHING
      RETURNING public_id
    `;
    return rows[0]?.public_id || null;
  }
  const result = backend.db.prepare(`
    INSERT OR IGNORE INTO outbox_events (public_id, organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(publicId, organizationId, aggregateType, aggregateId, eventType, dedupeKey, JSON.stringify(payload));
  return result.changes ? publicId : null;
}

function serializeOutbox(row) {
  return row ? { ...row, payload: deserializeBody(row.payload) || {}, attempts: Number(row.attempts || 0) } : null;
}

export async function claimOutboxEvents({ limit = 25 } = {}) {
  const backend = await getDatabaseBackend();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  if (backend.type === "postgres") {
    const rows = await backend.sql`
      WITH candidates AS (
        SELECT id FROM outbox_events
        WHERE status IN ('pending', 'failed') AND available_at <= NOW() AND attempts < 10
        ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT ${safeLimit}
      )
      UPDATE outbox_events event SET status = 'processing', attempts = event.attempts + 1, last_error_code = NULL
      FROM candidates WHERE event.id = candidates.id RETURNING event.*
    `;
    return rows.map(serializeOutbox);
  }
  backend.db.exec("BEGIN IMMEDIATE");
  try {
    const rows = backend.db.prepare(`SELECT * FROM outbox_events
      WHERE status IN ('pending', 'failed') AND datetime(available_at) <= CURRENT_TIMESTAMP AND attempts < 10
      ORDER BY available_at, id LIMIT ?`).all(safeLimit);
    const update = backend.db.prepare("UPDATE outbox_events SET status = 'processing', attempts = attempts + 1, last_error_code = NULL WHERE id = ? AND status IN ('pending', 'failed')");
    const claimed = rows.filter((row) => update.run(row.id).changes === 1).map((row) => serializeOutbox({ ...row, status: "processing", attempts: Number(row.attempts) + 1 }));
    backend.db.exec("COMMIT");
    return claimed;
  } catch (error) {
    backend.db.exec("ROLLBACK");
    throw error;
  }
}

export async function publishOutboxEvent(publicId) {
  const backend = await getDatabaseBackend();
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE outbox_events SET status = 'published', processed_at = NOW(), last_error_code = NULL
      WHERE public_id = ${publicId} AND status = 'processing' RETURNING public_id`;
    return Boolean(rows.length);
  }
  return Boolean(backend.db.prepare("UPDATE outbox_events SET status = 'published', processed_at = CURRENT_TIMESTAMP, last_error_code = NULL WHERE public_id = ? AND status = 'processing'").run(publicId).changes);
}

export async function retryOutboxEvent(publicId, errorCode = "PROCESSING_FAILED", attempts = 1) {
  const backend = await getDatabaseBackend();
  const safeCode = String(errorCode || "PROCESSING_FAILED").replace(/[^A-Z0-9_.-]/gi, "_").slice(0, 80);
  const delaySeconds = Math.min(3600, Math.max(30, 30 * (2 ** Math.min(6, Number(attempts) || 1))));
  if (backend.type === "postgres") {
    const rows = await backend.sql`UPDATE outbox_events SET status = 'failed', last_error_code = ${safeCode},
      available_at = NOW() + (${delaySeconds} * INTERVAL '1 second')
      WHERE public_id = ${publicId} AND status = 'processing' RETURNING public_id`;
    return Boolean(rows.length);
  }
  const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  return Boolean(backend.db.prepare("UPDATE outbox_events SET status = 'failed', last_error_code = ?, available_at = ? WHERE public_id = ? AND status = 'processing'").run(safeCode, availableAt, publicId).changes);
}
