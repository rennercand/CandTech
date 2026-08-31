import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260829_mfa.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_sessions' AND column_name='mfa_verified_at') AS session_column,
  to_regclass('public.user_mfa') IS NOT NULL AS user_mfa_table,
  to_regclass('public.mfa_recovery_codes') IS NOT NULL AS recovery_table,
  to_regclass('public.mfa_login_challenges') IS NOT NULL AS challenge_table`);
if (!verification?.session_column || !verification?.user_mfa_table || !verification?.recovery_table || !verification?.challenge_table) {
  throw new Error("Migration MFA incompleta.");
}
console.log("Migration MFA verificada com sucesso.");
