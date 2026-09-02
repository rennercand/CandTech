import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL ou POSTGRES_URL não configurada.");
const directory = dirname(fileURLToPath(import.meta.url));
const sql = neon(connectionString);
const source = await readFile(join(directory, "..", "migrations", "20260902_suppliers.sql"), "utf8");
const statements = source.split(";").map((value) => value.trim()).filter(Boolean);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));
const [result] = await sql`SELECT
  to_regclass('public.suppliers') IS NOT NULL AS table_ready,
  to_regclass('public.idx_suppliers_organization_name') IS NOT NULL AS name_index_ready,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_orders' AND column_name='supplier_id') AS order_link_ready,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_batches' AND column_name='supplier_id') AS batch_link_ready`;
console.log(JSON.stringify(result));
