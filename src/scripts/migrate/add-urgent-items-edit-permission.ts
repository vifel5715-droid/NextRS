/**
 * ARCH: Idempotent one-time data fix (run via `npm run migrate:add-urgent-items-edit-permission`).
 *
 * Grants can_edit=TRUE on the "urgent_items" permission key (see
 * core/security/permissionKeys.ts) — the "Urgent Item From IRS" page — to
 * custodian, purchaser, and admin. Needed because add-urgent-items-
 * permission.ts only ever granted the View row; back then the page had no
 * write action, so can_edit stayed at its column default (FALSE) for every
 * role, including admin (backfill-write-edit-permissions.ts predates this
 * page's Transaction Type / Amount feature and never touched this key
 * either). Without this, PUT .../purchasing-transaction 403s for every
 * role even though the page itself is visible.
 *
 * Safe to re-run: a role/key pair whose can_edit is already TRUE is left
 * alone; a role/key pair with no row at all is inserted with can_edit TRUE
 * directly (covers an install that never ran add-urgent-items-permission.ts).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const ROLES = ["custodian", "purchaser", "admin"];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let updated = 0;
    let inserted = 0;

    for (const role of ROLES) {
      const updateResult = await pool.query(
        `UPDATE role_permissions rp
         SET can_edit = TRUE
         FROM roles r
         WHERE rp.role_id = r.id
           AND lower(r.name) = lower($1)
           AND rp.permission_key = 'urgent_items'
           AND rp.can_edit = FALSE`,
        [role]
      );
      updated += updateResult.rowCount ?? 0;

      const insertResult = await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, can_edit, created_at)
         SELECT r.id, 'urgent_items', TRUE, $2
         FROM roles r
         WHERE lower(r.name) = lower($1)
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_key = 'urgent_items'
           )`,
        [role, now]
      );
      inserted += insertResult.rowCount ?? 0;

      console.log(`OK: "${role}" urgent_items can_edit (updated=${updateResult.rowCount ?? 0}, inserted=${insertResult.rowCount ?? 0})`);
    }

    console.log(`\nurgent_items edit-permission backfill completed successfully! (${updated} updated, ${inserted} inserted)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
