import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
const migrationFile = fileURLToPath(new URL("../migrations/20260901_pos_financial.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "").split(";").map((item) => item.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));
const [verification] = await sql.query(`SELECT COUNT(*)::int AS ready FROM information_schema.columns
  WHERE table_schema='public' AND table_name='inventory_orders'
    AND column_name IN ('customer_id','subtotal','discount_amount','payment_method','payment_status','due_on')`);
if (verification?.ready !== 6) throw new Error("Migration financeira do PDV incompleta.");
console.log("Migration financeira do PDV verificada com sucesso.");
