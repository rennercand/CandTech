import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabaseForTests } from "../lib/db.js";
import { getRuntimeDatabaseSecurity } from "../lib/database-security.js";

test("diagnóstico do banco local não finge validar a credencial de produção", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, sqlitePath: process.env.SQLITE_DATABASE_PATH };
  const directory = mkdtempSync(join(tmpdir(), "candtech-db-security-"));
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DATABASE_PATH = join(directory, "security.sqlite");
  try {
    const result = await getRuntimeDatabaseSecurity();
    assert.equal(result.mode, "sqlite-local");
    assert.equal(result.approved, null);
    assert.deepEqual(result.checks, {});
    assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await closeDatabaseForTests();
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.sqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previous.sqlitePath;
    rmSync(directory, { recursive: true, force: true });
  }
});
