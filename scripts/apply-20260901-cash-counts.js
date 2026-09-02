import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL ou POSTGRES_URL não configurada.");
const directory = dirname(fileURLToPath(import.meta.url));
const sql = neon(connectionString);
const source = await readFile(join(directory, "..", "migrations", "20260901_cash_counts.sql"), "utf8");
for (const statement of source.split(/;\s*(?:\r?\n|$)/).map((value) => value.trim()).filter(Boolean)) await sql.query(statement);
const [result] = await sql`SELECT to_regclass('public.cash_counts') IS NOT NULL AS table_ready,
  to_regclass('public.idx_cash_counts_organization_date') IS NOT NULL AS index_ready`;
console.log(JSON.stringify(result));
