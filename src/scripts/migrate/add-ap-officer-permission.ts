/**
 * ARCH: Idempotent one-time data fix (run via
 * `npm run migrate:add-ap-officer-permission`).
 *
 * Backfills can_edit=TRUE for the "ap_officer_dashboard" permission on
 * ap_officer and admin — the AP Officer Dashboard's only purpose is the
 * Approve/Decline action on a Reimbursement Request, so there's no
 * view-only phase worth having. A fresh `npm run init-db` +
 * `migrate:add-roles` already grants this directly (add-roles.ts's
 * EDIT_BY_DEFAULT set) — this script only backfills a database where
 * `migrate:add-roles` ran before that set included this key, which would
 * have inserted the row with can_edit defaulting to FALSE. Safe to re-run:
 * an UPDATE that changes nothing is a no-op.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const ROLES = ["ap_officer", "admin"];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    let updated = 0;

    for (const role of ROLES) {
      const result = await pool.query(
        `UPDATE role_permissions rp
         SET can_edit = TRUE
         FROM roles r
         WHERE rp.role_id = r.id
           AND lower(r.name) = lower($1)
           AND rp.permission_key = 'ap_officer_dashboard'
           AND rp.can_edit = FALSE`,
        [role]
      );
      updated += result.rowCount ?? 0;
      console.log(`OK: "${role}" ap_officer_dashboard can_edit (${result.rowCount ? "set to TRUE" : "already TRUE or role/grant missing"})`);
    }

    console.log(`\nap_officer_dashboard can_edit backfill completed successfully! (${updated} row(s) updated)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
