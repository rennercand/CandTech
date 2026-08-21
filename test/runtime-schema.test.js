import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function functionBody(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} deve existir`);
  assert.notEqual(end, -1, `${nextName} deve existir depois de ${name}`);
  return source.slice(start, end);
}

test("o runtime Postgres não executa migrations ou reparos de dados", () => {
  const database = readFileSync(new URL("../lib/db.js", import.meta.url), "utf8");
  const postgresInitialization = functionBody(database, "createPostgresBackend", "createSqliteBackend");

  assert.doesNotMatch(postgresInitialization, /CREATE\s+(?:TABLE|INDEX|TRIGGER|FUNCTION)/i);
  assert.doesNotMatch(postgresInitialization, /ALTER\s+TABLE/i);
  assert.doesNotMatch(postgresInitialization, /UPDATE\s+users/i);

  for (const file of ["inventory-db.js", "pix-db.js"]) {
    const source = readFileSync(new URL(`../lib/${file}`, import.meta.url), "utf8");
    const initialization = source.slice(0, source.indexOf("function serialize"));
    const postgresBranch = initialization.match(/backend\.type\s*===\s*["']postgres["']/i);
    assert.equal(postgresBranch, null, `${file} não deve criar schema no Postgres durante requisições`);
  }
});
