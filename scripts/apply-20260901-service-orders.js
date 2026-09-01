import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
const migrationFile = fileURLToPath(new URL("../migrations/20260901_service_orders.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "").split(";").map((item) => item.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));
const [verification] = await sql.query(`SELECT to_regclass('public.service_orders') IS NOT NULL AS orders_ready,
  to_regclass('public.service_order_items') IS NOT NULL AS items_ready`);
if (!verification?.orders_ready || !verification?.items_ready) throw new Error("Migration de ordens de serviço incompleta.");
console.log("Migration de ordens de serviço verificada com sucesso.");
