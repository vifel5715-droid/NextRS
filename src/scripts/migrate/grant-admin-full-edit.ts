/**
 * ARCH: Idempotent one-time data fix (run via `npm run migrate:grant-admin-full-edit`).
 *
 * Grants can_edit=TRUE on every permission_key the built-in `admin` role
 * already holds a row for. Admin is meant to have full write access to
 * everything it can view — every other per-key backfill script in this
 * folder (fix-admin-create-request-permission.ts, add-ap-officer-permission.ts,
 * add-urgent-items-edit-permission.ts, ...) assumes admin already has this,
 * but nothing ever actually granted it in bulk; it happened to be true
 * historically from how the role was first seeded, before the View/Edit
 * split existed as a general concept. This is the first script to state and
 * enforce that assumption directly, so a database whose role_permissions
 * table was ever wiped/reseeded from scratch (add-roles.ts's default insert
 * leaves can_edit=FALSE for every key outside EDIT_BY_DEFAULT) can be fully
 * repaired for admin in one step instead of one dedicated fix per key.
 * Safe to re-run: an UPDATE that changes nothing is a no-op.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const result = await pool.query(
      `UPDATE role_permissions rp
       SET can_edit = TRUE
       FROM roles r
       WHERE rp.role_id = r.id
         AND lower(r.name) = 'admin'
         AND rp.can_edit = FALSE`
    );

    console.log(`OK: admin full-edit grant (${result.rowCount ?? 0} permission key(s) updated to can_edit=TRUE)`);
    console.log("\nAdmin full-edit backfill completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
