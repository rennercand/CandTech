import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser, getDatabaseBackend } from "../lib/db.js";
import {
  claimIdempotency,
  completeIdempotency,
  enqueueOutboxEvent,
  failIdempotency,
} from "../lib/idempotency-db.js";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "../lib/idempotency.js";

test("idempotência persiste resultado, rejeita conflito e permite retomar falha", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, sqlitePath: process.env.SQLITE_DATABASE_PATH, databaseUrl: process.env.DATABASE_URL };
  const directory = mkdtempSync(join(tmpdir(), "candtech-idempotency-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "idempotency.sqlite");
  delete process.env.DATABASE_URL;
  try {
    const user = await createUser({ name: "Idempotência", email: "idempotency@test.local", passwordHash: "hash" });
    const keyHash = hashIdempotencyValue("request-key-0001");
    const requestHash = hashIdempotencyRequest({ amount: 60, nested: { b: 2, a: 1 } });
    assert.equal(hashIdempotencyRequest({ nested: { a: 1, b: 2 }, amount: 60 }), requestHash);
    assert.equal(normalizeIdempotencyKey("request-key-0001"), "request-key-0001");
    assert.equal(normalizeIdempotencyKey("curta"), null);

    const context = { userId: user.id, operation: "payment.create", keyHash, requestHash };
    assert.equal((await claimIdempotency(context)).state, "claimed");
    assert.equal((await claimIdempotency(context)).state, "pending");
    assert.equal((await claimIdempotency({ ...context, requestHash: hashIdempotencyRequest({ amount: 180 }) })).state, "conflict");
    assert.equal(await completeIdempotency({ ...context, status: 201, body: { id: "payment-1" } }), true);
    assert.deepEqual(await claimIdempotency(context), { state: "replay", status: 201, body: { id: "payment-1" } });

    const retry = { userId: user.id, operation: "history.save", keyHash: hashIdempotencyValue("request-key-0002"), requestHash };
    assert.equal((await claimIdempotency(retry)).state, "claimed");
    await failIdempotency(retry);
    assert.equal((await claimIdempotency(retry)).state, "claimed");

    const email = { ...context, operation: "admin.account-backup.email", allowReclaim: false };
    assert.equal((await claimIdempotency(email)).state, "claimed");
    const backend = await getDatabaseBackend();
    assert.equal(backend.type, "sqlite");
    backend.db.prepare("UPDATE idempotency_keys SET locked_until='2000-01-01', expires_at='2000-01-01' WHERE operation=?").run(email.operation);
    assert.equal((await claimIdempotency(email)).state, "pending", "não reenvia após interrupção e expiração");
    await failIdempotency(email);
    assert.equal((await claimIdempotency(email)).state, "pending", "não retoma falha externa incerta");
    assert.equal((await claimIdempotency({ ...email, requestHash: "different" })).state, "conflict");
    // A resposta final continua reutilizável sem executar o efeito novamente.
    const completedEmail = { ...email, keyHash: hashIdempotencyValue("completed-email-operation") };
    assert.equal((await claimIdempotency(completedEmail)).state, "claimed");
    await completeIdempotency({ ...completedEmail, status: 202, body: { accepted: true } });
    assert.deepEqual(await claimIdempotency(completedEmail), { state: "replay", status: 202, body: { accepted: true } });

    const firstEvent = await enqueueOutboxEvent({ aggregateType: "payment", aggregateId: "payment-1", eventType: "payment.created", dedupeKey: keyHash, payload: { amount: 60 } });
    assert.match(firstEvent, /^[0-9a-f-]{36}$/i);
    const duplicateEvent = await enqueueOutboxEvent({ aggregateType: "payment", aggregateId: "payment-1", eventType: "payment.created", dedupeKey: keyHash, payload: { amount: 60 } });
    assert.equal(duplicateEvent, null);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.databaseUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
