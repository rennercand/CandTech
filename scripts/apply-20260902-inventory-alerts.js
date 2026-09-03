import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL ou POSTGRES_URL não configurada.");
const directory = dirname(fileURLToPath(import.meta.url));
const sql = neon(connectionString);
const source = await readFile(join(directory, "..", "migrations", "20260902_inventory_alerts.sql"), "utf8");
const statements = source.split(";").map((value) => value.trim()).filter(Boolean);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));
const [result] = await sql`SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_variants' AND column_name='restock_reminder_on') AS reminder_ready,
  to_regclass('public.idx_inventory_variants_organization_restock_alert') IS NOT NULL AS alert_index_ready`;
console.log(JSON.stringify(result));
