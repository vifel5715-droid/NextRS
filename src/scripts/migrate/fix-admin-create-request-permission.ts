/**
 * ARCH: Idempotent one-time data fix (run via `npm run migrate:fix-admin-create-request`).
 *
 * The built-in `admin` role was missing a `create_request` row in
 * role_permissions — every other permission key was present with
 * can_edit=true (see scripts/migrate/add-roles.ts's ALL_PERMISSIONS), but
 * `create_request` wasn't, likely because it was added to PERMISSION_KEYS
 * after admin's row was originally seeded and never backfilled. This went
 * unnoticed because every route that gated on "admin" checked the JWT role
 * string directly (ProtectedRoute's old allowedRoles arrays), never this
 * permission table — now that those routes check requiredPermission
 * instead (see AppRoutes.tsx), admin needs the grant to match every other
 * permission it already has. Safe to re-run: a no-op once the row exists.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, can_edit, created_at)
       SELECT r.id, 'create_request', true, $1
       FROM roles r
       WHERE r.name = 'admin'
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp
           WHERE rp.role_id = r.id AND rp.permission_key = 'create_request'
         )`,
      [now]
    );

    console.log(`OK: admin create_request permission (${result.rowCount ?? 0} inserted, ${(result.rowCount ?? 0) > 0 ? 0 : 1} already present)`);
    console.log("\nAdmin permission fix completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
