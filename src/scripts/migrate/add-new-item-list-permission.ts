/**
 * ARCH: Idempotent one-time data fix (run via
 * `npm run migrate:add-new-item-list-permission`).
 *
 * Adds the new "new_item_list" permission key (see core/security/
 * permissionKeys.ts) — the "New Item List" sidebar page, listing
 * item_request_items rows that are pr_type URGENT + Inventoriable (see
 * UrgentItemsPage.tsx / NewItemListPage.tsx) — to custodian and admin on an
 * existing install. A fresh `npm run init-db` + `migrate:add-roles` already
 * seeds this directly via add-roles.ts's CUSTODIAN/ALL_PERMISSIONS arrays —
 * this script only backfills a database where those roles were seeded
 * before this key existed. Safe to re-run: a role/key pair that already
 * exists is left alone rather than reset to some default.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const ROLES = ["custodian", "director", "admin"];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;

    for (const role of ROLES) {
      const result = await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, can_edit, created_at)
         SELECT r.id, 'new_item_list', TRUE, $2
         FROM roles r
         WHERE lower(r.name) = lower($1)
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_key = 'new_item_list'
           )`,
        [role, now]
      );
      inserted += result.rowCount ?? 0;
      console.log(`OK: "${role}" new_item_list permission (${result.rowCount ? "granted" : "already present or role missing"})`);
    }

    console.log(`\nnew_item_list permission backfill completed successfully! (${inserted} row(s) inserted)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
