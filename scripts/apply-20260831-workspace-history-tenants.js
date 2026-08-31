import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_workspace_history_tenants.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='histories' AND column_name='organization_id') AS histories_scope,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='workspaces' AND column_name='organization_id') AS workspaces_scope,
  NOT EXISTS (
    SELECT 1 FROM histories h JOIN organizations o ON o.owner_user_id = h.user_id
    WHERE h.organization_id IS DISTINCT FROM o.id
  ) AS histories_backfilled,
  NOT EXISTS (
    SELECT 1 FROM workspaces w JOIN organizations o ON o.owner_user_id = w.user_id
    WHERE w.organization_id IS DISTINCT FROM o.id
  ) AS workspaces_backfilled`);
if (!verification?.histories_scope || !verification?.workspaces_scope || !verification?.histories_backfilled || !verification?.workspaces_backfilled) {
  throw new Error("Migration de isolamento de workspace/histórico incompleta.");
}
console.log("Migration de isolamento de workspace e histórico verificada com sucesso.");
