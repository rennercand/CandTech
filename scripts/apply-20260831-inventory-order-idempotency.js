import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_inventory_order_idempotency.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "")
  .split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_orders' AND column_name='idempotency_key_hash') AS column_ready,
  to_regclass('public.idx_inventory_orders_organization_idempotency') IS NOT NULL AS index_ready`);
if (!verification?.column_ready || !verification?.index_ready) {
  throw new Error("Migration de idempotência dos pedidos incompleta.");
}
console.log("Idempotência persistida dos pedidos verificada com sucesso.");
