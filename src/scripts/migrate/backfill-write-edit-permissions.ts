/**
 * ARCH: Idempotent one-time data fix (run via
 * `npm run migrate:backfill-write-edit-permissions`).
 *
 * Every write/approve/reject/HOLD/delete/reset route used to be gated by a
 * hardcoded role-name allow-list (roleMiddleware(["staff", ...])) instead
 * of the Roles admin screen's Edit checkboxes — the same class of bug fixed
 * earlier for GET/list routes (see item-catalog.routes.ts, option-list.
 * routes.ts, users.routes.ts), except here removing the hardcoded list
 * outright would have been a real regression: only the built-in `admin`
 * role currently has ANY can_edit=true row (see the ARCH note on
 * middleware/permission.ts's editPermissionMiddleware).
 *
 * This backfills can_edit=true on the exact (role, permission_key) pairs
 * that reproduce each built-in role's CURRENT write access — transcribed
 * 1:1 from the role arrays that are being removed from item-request.routes.ts,
 * service-request.routes.ts, status.routes.ts, deletion-log.routes.ts,
 * item-catalog.routes.ts, and roles.routes.ts. After this runs, those
 * routes check editPermissionMiddleware instead, so today's behavior is
 * unchanged, but an admin can now also grant or revoke any of this — for
 * built-in or custom roles — from the Roles screen. Safe to re-run: a row
 * already can_edit=true is left alone; a role/key pair with no existing
 * (view) grant is skipped rather than creating one, since granting write
 * access without view access first would be meaningless.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const GRANTS: Array<[role: string, key: string]> = [
  // Create New Request — own-request creation/editing (item + service),
  // attachment management. Custodian included: an earlier fix already let
  // custodian create requests via the old role-array; this formalizes it.
  ["staff", "create_request"],
  ["secretary", "create_request"],
  ["supervisor", "create_request"],
  ["manager", "create_request"],
  ["custodian", "create_request"],

  // Pending Requests (Custodian/Admin) — approve/reject as custodian, add
  // status, delete a request, clear a receiving report, delete an issuance
  // audit, item-catalog maintenance is reached from the same role's tools.
  ["custodian", "department_requests"],

  // Supervisor Dashboard — approve/reject as supervisor.
  ["supervisor", "supervisor_dashboard"],
  ["manager", "supervisor_dashboard"],

  // Held Items — Secretary/Supervisor/Manager's narrow HOLD-item/HOLD-service
  // fix hand-off (item name, service description) once a custodian has
  // flagged something ON HOLD.
  ["secretary", "held_items"],
  ["supervisor", "held_items"],
  ["manager", "held_items"],

  // Deleted — recovering a deleted line back onto its request.
  ["custodian", "deleted_items"],

  // Item List — maintaining the item catalog (add/rename/remove entries).
  ["custodian", "item_list"],

  // Purchaser Dashboard — classifying an item Purchase Order vs Payment
  // Request, and filling out/saving that request's Payment Request Form.
  ["purchaser", "purchaser_dashboard"],
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    let updated = 0;
    let skippedNoGrant = 0;
    let alreadySet = 0;

    for (const [role, key] of GRANTS) {
      const result = await pool.query(
        `UPDATE role_permissions rp
         SET can_edit = true
         FROM roles r
         WHERE rp.role_id = r.id
           AND lower(r.name) = lower($1)
           AND rp.permission_key = $2
           AND rp.can_edit = false`,
        [role, key]
      );
      if ((result.rowCount ?? 0) > 0) {
        updated += 1;
        continue;
      }

      const [existing] = (
        await pool.query(
          `SELECT rp.can_edit
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           WHERE lower(r.name) = lower($1) AND rp.permission_key = $2`,
          [role, key]
        )
      ).rows;

      if (!existing) {
        skippedNoGrant += 1;
        console.warn(`SKIP: role "${role}" has no "${key}" view grant to attach can_edit to — check add-roles.ts seeding.`);
      } else {
        alreadySet += 1;
      }
    }

    console.log(`OK: write-edit permission backfill (${updated} updated, ${alreadySet} already set, ${skippedNoGrant} skipped)`);
    console.log("\nWrite-edit permission backfill completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
