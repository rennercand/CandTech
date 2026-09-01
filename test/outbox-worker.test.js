import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser, getDatabaseBackend } from "../lib/db.js";
import { enqueueOutboxEvent } from "../lib/idempotency-db.js";
import { processOutboxBatch } from "../lib/outbox-worker.js";

test("worker publica eventos conhecidos uma vez e retenta tipo desconhecido", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, sqlitePath: process.env.SQLITE_DATABASE_PATH };
  const directory = mkdtempSync(join(tmpdir(), "candtech-outbox-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "outbox.sqlite");
  try {
    await createUser({ name: "Outbox", email: "outbox@test.local", passwordHash: "hash" });
    await enqueueOutboxEvent({ aggregateType: "history", aggregateId: "h-1", eventType: "history.created", dedupeKey: "known-1" });
    await enqueueOutboxEvent({ aggregateType: "future", aggregateId: "f-1", eventType: "future.unknown", dedupeKey: "unknown-1" });
    assert.deepEqual(await processOutboxBatch(), { claimed: 2, published: 1, failed: 1 });
    const backend = await getDatabaseBackend();
    const known = backend.db.prepare("SELECT status, attempts FROM outbox_events WHERE dedupe_key = 'known-1'").get();
    const unknown = backend.db.prepare("SELECT status, attempts, last_error_code FROM outbox_events WHERE dedupe_key = 'unknown-1'").get();
    assert.equal(known.status, "published");
    assert.equal(known.attempts, 1);
    assert.equal(unknown.status, "failed");
    assert.equal(unknown.attempts, 1);
    assert.equal(unknown.last_error_code, "UNSUPPORTED_EVENT_TYPE");
    assert.deepEqual(await processOutboxBatch(), { claimed: 0, published: 0, failed: 0 });
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH; else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
