import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_relational_deliveries.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  to_regclass('public.operational_deliveries') IS NOT NULL AS deliveries_table,
  NOT EXISTS (SELECT 1 FROM workspaces WHERE deliveries_relational_at IS NULL) AS workspaces_marked,
  NOT EXISTS (
    SELECT 1 FROM operational_deliveries delivery
    JOIN organizations organization ON organization.owner_user_id = delivery.owner_user_id
    WHERE delivery.organization_id IS DISTINCT FROM organization.id
  ) AS deliveries_scoped`);
if (!verification?.deliveries_table || !verification?.workspaces_marked || !verification?.deliveries_scoped) {
  throw new Error("Migration relacional de entregas incompleta.");
}
console.log("Migration relacional de entregas verificada com sucesso.");
