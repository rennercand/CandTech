import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests, createUser } from "../lib/db.js";
import {
  claimIdempotency,
  completeIdempotency,
  enqueueOutboxEvent,
  failIdempotency,
} from "../lib/idempotency-db.js";
import { hashIdempotencyRequest, hashIdempotencyValue, normalizeIdempotencyKey } from "../lib/idempotency.js";

test("idempotência persiste resultado, rejeita conflito e permite retomar falha", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, sqlitePath: process.env.SQLITE_DATABASE_PATH };
  const directory = mkdtempSync(join(tmpdir(), "candtech-idempotency-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "idempotency.sqlite");
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
    rmSync(directory, { recursive: true, force: true });
  }
});
