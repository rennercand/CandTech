import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260828_billing_setup_paid.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='billing_profiles' AND column_name='setup_paid_at'
) AS setup_paid_column`);

if (!verification?.setup_paid_column) throw new Error("A coluna setup_paid_at não foi criada.");
console.log("Migration de implantação única verificada com sucesso.");
