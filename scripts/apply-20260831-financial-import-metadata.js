import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_financial_import_metadata.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "")
  .split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='financial_ledger_entries' AND column_name='import_batch_public_id'
  ) AS batch_column,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='financial_ledger_entries' AND column_name='fingerprint'
  ) AS fingerprint_column,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_financial_ledger_import_fingerprint'
  ) AS fingerprint_index`);
if (!verification?.batch_column || !verification?.fingerprint_column || !verification?.fingerprint_index) {
  throw new Error("Migration de metadados da importação financeira incompleta.");
}
console.log("Migration de metadados da importação financeira verificada com sucesso.");
