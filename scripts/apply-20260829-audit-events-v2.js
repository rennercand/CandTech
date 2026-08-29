import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260829_audit_events_v2.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const requiredColumns = ["actor_user_id", "organization_id", "origin", "event_version", "subject_type", "subject_id", "previous_state", "new_state"];
const columns = await sql.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='audit_events'`);
const present = new Set(columns.map((row) => row.column_name));
const missing = requiredColumns.filter((column) => !present.has(column));
if (missing.length) throw new Error(`Migration de auditoria incompleta: ${missing.join(", ")}`);
console.log("Migration audit_events v2 verificada com sucesso.");
