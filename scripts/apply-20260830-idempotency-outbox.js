import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260830_idempotency_outbox.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  to_regclass('public.idempotency_keys') IS NOT NULL AS idempotency_table,
  to_regclass('public.outbox_events') IS NOT NULL AS outbox_table`);
if (!verification?.idempotency_table || !verification?.outbox_table) {
  throw new Error("Migration de idempotência/outbox incompleta.");
}
console.log("Migration de idempotência e outbox verificada com sucesso.");
