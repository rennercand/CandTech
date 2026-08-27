import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const migrationFiles = [
  "../migrations/20260826_pix_payment_receipts.sql",
  "../migrations/20260826_staff_access.sql",
];

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

function statementsFrom(file) {
  // Os arquivos permitidos são versionados e não contêm funções com ';' no
  // corpo. Comentários de linha são removidos antes da divisão controlada.
  return readFileSync(file, "utf8")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const sql = neon(process.env.DATABASE_URL);
for (const relativeFile of migrationFiles) {
  const file = fileURLToPath(new URL(relativeFile, import.meta.url));
  const statements = statementsFrom(file);
  await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));
  console.log(`Migration aplicada: ${relativeFile.split("/").pop()}`);
}

const [verification] = await sql.query(`SELECT
  to_regclass('public.pix_payment_receipts')::text AS receipts,
  to_regclass('public.staff_access')::text AS staff`);
if (verification?.receipts !== "pix_payment_receipts" || verification?.staff !== "staff_access") {
  throw new Error("A verificação das tabelas migradas falhou.");
}
console.log("Migrations de 26/08 verificadas com sucesso.");
