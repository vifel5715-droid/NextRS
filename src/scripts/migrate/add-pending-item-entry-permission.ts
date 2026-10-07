/**
 * ARCH: Idempotent one-time data fix (run via
 * `npm run migrate:add-pending-item-entry-permission`).
 *
 * Adds the new "pending_item_entry" permission key (see core/security/
 * permissionKeys.ts) — the "Pending Item Entry" sidebar page, listing
 * item_request_items rows that are Payment Request + Inventoriable and
 * still need a matching Item Catalog entry registered — to custodian and
 * admin on an existing install. Granted with can_edit TRUE from the start
 * (unlike urgent_items' original view-only grant): this page's only
 * purpose is the custodian's "register a catalog counterpart" action, so
 * there is no view-only phase worth shipping first. A fresh `npm run
 * init-db` + `migrate:add-roles` already seeds this directly via
 * add-roles.ts's CUSTODIAN/ALL_PERMISSIONS arrays — this script only
 * backfills a database where those roles were seeded before this key
 * existed. Safe to re-run: a role/key pair that already exists is left
 * alone rather than reset to some default.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const ROLES = ["custodian", "admin"];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;

    for (const role of ROLES) {
      const result = await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, can_edit, created_at)
         SELECT r.id, 'pending_item_entry', TRUE, $2
         FROM roles r
         WHERE lower(r.name) = lower($1)
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_key = 'pending_item_entry'
           )`,
        [role, now]
      );
      inserted += result.rowCount ?? 0;
      console.log(`OK: "${role}" pending_item_entry permission (${result.rowCount ? "granted" : "already present or role missing"})`);
    }

    console.log(`\npending_item_entry permission backfill completed successfully! (${inserted} row(s) inserted)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
