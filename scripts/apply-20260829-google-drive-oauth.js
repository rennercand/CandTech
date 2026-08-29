import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260829_google_drive_oauth.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const requiredColumns = [
  "nonce_hash", "user_id", "session_hash", "provider", "encrypted_code_verifier",
  "expires_at", "used_at", "created_at",
];
const columns = await sql.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='oauth_transactions'`);
const present = new Set(columns.map((row) => row.column_name));
const missing = requiredColumns.filter((column) => !present.has(column));
if (missing.length) throw new Error(`Migration OAuth incompleta: ${missing.join(", ")}`);
console.log("Migration OAuth do Google Drive verificada com sucesso.");
