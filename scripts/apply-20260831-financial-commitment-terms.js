import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_financial_commitment_terms.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "")
  .split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  COUNT(*) FILTER (WHERE column_name IN (
    'interest_amount','penalty_amount','discount_amount','paid_amount','series_public_id',
    'recurrence','installment_number','installment_count'
  )) = 8 AS columns_ready,
  to_regclass('public.idx_financial_commitments_series') IS NOT NULL AS series_index_ready,
  NOT EXISTS (
    SELECT 1 FROM financial_commitments
    WHERE paid_amount < 0 OR interest_amount < 0 OR penalty_amount < 0 OR discount_amount < 0
  ) AS values_valid
FROM information_schema.columns
WHERE table_schema='public' AND table_name='financial_commitments'`);
if (!verification?.columns_ready || !verification?.series_index_ready || !verification?.values_valid) {
  throw new Error("Migration de condições financeiras das contas incompleta.");
}
console.log("Migration de recorrência, parcelas e pagamentos parciais verificada com sucesso.");
