import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  closeDatabaseForTests,
  createHistory,
  createUser,
  listHistories,
} from "../lib/db.js";

test("histórico usa cursor estável, limite máximo e isolamento por conta", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    sqlitePath: process.env.SQLITE_DATABASE_PATH,
  };
  const directory = mkdtempSync(join(tmpdir(), "candtech-history-page-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "history.sqlite");
  try {
    const ownerA = await createUser({ name: "Empresa A", email: "page-a@test.local", passwordHash: "hash" });
    const ownerB = await createUser({ name: "Empresa B", email: "page-b@test.local", passwordHash: "hash" });
    for (let index = 1; index <= 5; index += 1) {
      await createHistory({
        userId: ownerA.id,
        title: `Documento ${index}`,
        calculationType: index % 2 ? "investimento" : "fluxo-caixa",
        payload: { index },
      });
    }
    await createHistory({ userId: ownerB.id, title: "Documento privado", calculationType: "investimento", payload: { index: 99 } });

    const first = await listHistories(ownerA.id, null, { limit: 2 });
    assert.deepEqual(first.rows.map((row) => row.title), ["Documento 5", "Documento 4"]);
    assert.ok(first.nextCursor);
    const second = await listHistories(ownerA.id, null, { limit: 2, cursor: first.nextCursor });
    assert.deepEqual(second.rows.map((row) => row.title), ["Documento 3", "Documento 2"]);
    assert.ok(second.nextCursor);
    const third = await listHistories(ownerA.id, null, { limit: 2, cursor: second.nextCursor });
    assert.deepEqual(third.rows.map((row) => row.title), ["Documento 1"]);
    assert.equal(third.nextCursor, null);
    assert.equal([...first.rows, ...second.rows, ...third.rows].some((row) => row.title === "Documento privado"), false);

    const filtered = await listHistories(ownerA.id, "investimento", { limit: 50 });
    assert.deepEqual(filtered.rows.map((row) => row.title), ["Documento 5", "Documento 3", "Documento 1"]);
    const invalidCursor = await listHistories(ownerA.id, null, { limit: 2, cursor: "nao-e-um-cursor" });
    assert.deepEqual(invalidCursor.rows, []);
    assert.equal(invalidCursor.invalidCursor, true);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
