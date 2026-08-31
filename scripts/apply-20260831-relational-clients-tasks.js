import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_relational_clients_tasks.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  to_regclass('public.customers') IS NOT NULL AS customers_table,
  to_regclass('public.operational_tasks') IS NOT NULL AS tasks_table,
  NOT EXISTS (
    SELECT 1 FROM workspaces
    WHERE clients_relational_at IS NULL OR tasks_relational_at IS NULL
  ) AS workspaces_marked,
  NOT EXISTS (
    SELECT 1 FROM customers c
    JOIN organizations o ON o.owner_user_id = c.owner_user_id
    WHERE c.organization_id IS DISTINCT FROM o.id
  ) AS customers_scoped,
  NOT EXISTS (
    SELECT 1 FROM operational_tasks t
    JOIN organizations o ON o.owner_user_id = t.owner_user_id
    WHERE t.organization_id IS DISTINCT FROM o.id
  ) AS tasks_scoped`);

if (!verification?.customers_table || !verification?.tasks_table || !verification?.workspaces_marked
  || !verification?.customers_scoped || !verification?.tasks_scoped) {
  throw new Error("Migration relacional de clientes e tarefas incompleta.");
}
console.log("Migration relacional de clientes e tarefas verificada com sucesso.");
