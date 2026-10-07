/**
 * ARCH: One-time additive migration (run via
 * `npm run migrate:add-operations-manager-role`).
 *
 * Adds the "operations_manager" built-in role — a cross-cutting approver
 * that can SEE every approval-stage dashboard (Supervisor, Custodian/
 * Stockroom, Purchaser, AP Officer) but can only ACT on the Supervisor/
 * Manager stage ("department request" approval) for every request type.
 * Custodian, Purchaser, and AP Officer keep sole approval rights over their
 * own stage — see seedRoles.ts's OPERATIONS_MANAGER permission list (view
 * access to all four) and this script's explicit can_edit grant (only
 * supervisor_dashboard).
 *
 * Safe to re-run: seedBuiltInRoles() is itself idempotent, and the can_edit
 * UPDATE only touches rows currently false.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { seedBuiltInRoles } from "../../database/seedRoles.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await seedBuiltInRoles(pool);

    const grantEdit = await pool.query(
      `UPDATE role_permissions rp
       SET can_edit = true
       FROM roles r
       WHERE rp.role_id = r.id
         AND lower(r.name) = 'operations_manager'
         AND rp.permission_key = 'supervisor_dashboard'
         AND rp.can_edit = false`
    );
    console.log(`OK: operations_manager can_edit on supervisor_dashboard (${grantEdit.rowCount ?? 0} updated)`);

    // seedBuiltInRoles() sets can_edit from EDIT_BY_DEFAULT per permission
    // key, globally — not per role. "ap_officer_dashboard" is in that set
    // (so a fresh AP Officer install doesn't need a separate edit-grant
    // step), which means Operations Manager's own ap_officer_dashboard row
    // came back can_edit=true too, even though AP Officer alone should be
    // able to approve/close there. Force it back to view-only.
    const revokeApEdit = await pool.query(
      `UPDATE role_permissions rp
       SET can_edit = false
       FROM roles r
       WHERE rp.role_id = r.id
         AND lower(r.name) = 'operations_manager'
         AND rp.permission_key = 'ap_officer_dashboard'
         AND rp.can_edit = true`
    );
    console.log(`OK: operations_manager can_edit revoked on ap_officer_dashboard (${revokeApEdit.rowCount ?? 0} updated)`);

    console.log("\nOperations Manager role migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
