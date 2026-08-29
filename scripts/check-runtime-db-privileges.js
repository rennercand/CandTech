import { neon } from "@neondatabase/serverless";

if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("DATABASE_URL da credencial de runtime não configurada.");
}

const sql = neon(process.env.DATABASE_URL);
const [role] = await sql.query(`
  SELECT
    current_user AS role_name,
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
`);

if (!role) throw new Error("Não foi possível identificar a credencial de runtime.");

const dangerous = [
  role.is_superuser && "superuser",
  role.can_create_database && "CREATEDB",
  role.can_create_role && "CREATEROLE",
  role.can_create_schema_objects && "CREATE no schema public",
  role.owns_public_objects && "proprietária de objetos no schema public",
].filter(Boolean);

if (dangerous.length) {
  throw new Error(`Credencial de runtime possui privilégios DDL: ${dangerous.join(", ")}.`);
}

console.log(`Credencial de runtime aprovada: ${role.role_name} não possui privilégios DDL detectáveis.`);
