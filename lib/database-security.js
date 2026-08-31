import { getDatabaseBackend } from "./db.js";

export async function getRuntimeDatabaseSecurity() {
  const backend = await getDatabaseBackend();
  if (backend.type !== "postgres") {
    return {
      mode: "sqlite-local",
      approved: null,
      checks: {},
      checkedAt: new Date().toISOString(),
    };
  }

  const rows = await backend.sql`
    SELECT
      COALESCE(r.rolsuper, FALSE) AS is_superuser,
      COALESCE(r.rolcreatedb, FALSE) AS can_create_database,
      COALESCE(r.rolcreaterole, FALSE) AS can_create_role,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
          AND pg_get_userbyid(c.relowner) = current_user
      ) AS owns_public_objects
    FROM pg_roles r
    WHERE r.rolname = current_user
  `;
  const role = rows[0];
  if (!role) throw new Error("RUNTIME_DATABASE_ROLE_NOT_FOUND");
  const checks = {
    superuser: Boolean(role.is_superuser),
    createDatabase: Boolean(role.can_create_database),
    createRole: Boolean(role.can_create_role),
    createSchemaObjects: Boolean(role.can_create_schema_objects),
    ownsPublicObjects: Boolean(role.owns_public_objects),
  };
  return {
    mode: "postgres",
    approved: !Object.values(checks).some(Boolean),
    checks,
    checkedAt: new Date().toISOString(),
  };
}
