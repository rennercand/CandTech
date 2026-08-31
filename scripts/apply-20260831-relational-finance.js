import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_relational_finance.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "")
  .split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  to_regclass('public.financial_accounts') IS NOT NULL AS accounts_table,
  to_regclass('public.financial_commitments') IS NOT NULL AS commitments_table,
  to_regclass('public.financial_ledger_entries') IS NOT NULL AS ledger_table,
  NOT EXISTS (SELECT 1 FROM workspaces WHERE finance_relational_at IS NULL) AS workspaces_marked,
  NOT EXISTS (
    SELECT 1 FROM financial_ledger_entries entry
    JOIN organizations organization ON organization.owner_user_id=entry.owner_user_id
    WHERE entry.organization_id IS DISTINCT FROM organization.id
  ) AS ledger_scoped`);
if (!verification?.accounts_table || !verification?.commitments_table || !verification?.ledger_table
  || !verification?.workspaces_marked || !verification?.ledger_scoped) {
  throw new Error("Migration relacional financeira incompleta.");
}
console.log("Migration relacional financeira verificada com sucesso.");
