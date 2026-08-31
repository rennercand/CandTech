import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL PostgreSQL não configurada para a migration.");
}

const migrationFile = fileURLToPath(new URL("../migrations/20260831_inventory_organization_scope.sql", import.meta.url));
const statements = readFileSync(migrationFile, "utf8").replace(/^\s*--.*$/gm, "")
  .split(";").map((statement) => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction((transaction) => statements.map((statement) => transaction.query(statement)));

const [verification] = await sql.query(`WITH scoped AS (
  SELECT tenant_id, organization_id FROM inventory_products
  UNION ALL SELECT tenant_id, organization_id FROM inventory_variants
  UNION ALL SELECT tenant_id, organization_id FROM inventory_batches
  UNION ALL SELECT tenant_id, organization_id FROM inventory_movements
  UNION ALL SELECT tenant_id, organization_id FROM inventory_orders
)
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='public' AND column_name='organization_id'
      AND table_name IN ('inventory_products','inventory_variants','inventory_batches','inventory_movements','inventory_orders')) = 5 AS columns_ready,
  NOT EXISTS (
    SELECT 1 FROM scoped
    WHERE tenant_id LIKE 'organization:%' AND organization_id IS NULL
  ) AS all_company_rows_scoped,
  NOT EXISTS (
    SELECT 1 FROM scoped
    WHERE organization_id IS NOT NULL AND tenant_id <> 'organization:' || organization_id::text
  ) AS tenant_matches_organization,
  NOT EXISTS (
    SELECT 1 FROM inventory_variants variant
    JOIN inventory_products product ON product.id=variant.product_id
    WHERE variant.organization_id IS DISTINCT FROM product.organization_id
  ) AS variants_scoped,
  NOT EXISTS (
    SELECT 1 FROM inventory_movements movement
    JOIN inventory_batches batch ON batch.id=movement.batch_id
    JOIN inventory_variants variant ON variant.id=movement.variant_id
    WHERE movement.organization_id IS DISTINCT FROM batch.organization_id
       OR movement.organization_id IS DISTINCT FROM variant.organization_id
  ) AS movements_scoped,
  NOT EXISTS (
    SELECT 1 FROM inventory_orders inventory_order
    JOIN inventory_batches batch ON batch.id=inventory_order.batch_id
    WHERE inventory_order.organization_id IS DISTINCT FROM batch.organization_id
  ) AS orders_scoped`);

if (!verification?.columns_ready || !verification?.all_company_rows_scoped
  || !verification?.tenant_matches_organization || !verification?.variants_scoped
  || !verification?.movements_scoped || !verification?.orders_scoped) {
  throw new Error("Migração aditiva do escopo organizacional do estoque incompleta.");
}
console.log("Escopo organizacional aditivo do estoque verificado com sucesso.");
