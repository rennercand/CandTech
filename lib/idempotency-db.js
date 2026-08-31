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
