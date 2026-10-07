/**
 * ARCH: Idempotent one-time data fix (run via `npm run migrate:add-urgent-items-permission`).
 *
 * Adds the new "urgent_items" permission key (see core/security/permissionKeys.ts)
 * — the "Urgent Item From IRS" sidebar page, a dedicated read-only view of
 * item_request_items rows with pr_type = 'URGENT' (see PendingItemsPage.tsx's
 * existing "Urgent Item" tile, which this promotes to its own page) — to the
 * roles that should see it on an existing install: custodian, purchaser, and
 * admin (which always mirrors ALL_PERMISSIONS per add-roles.ts). A fresh
 * `npm run init-db` + `migrate:add-roles` already seeds this directly via
 * add-roles.ts's CUSTODIAN/PURCHASER/ALL_PERMISSIONS arrays — this script
 * only backfills a database where those roles were seeded before this key
 * existed. View-only (can_edit stays false); the page has no write action.
 * Safe to re-run: a role/key pair that already exists is skipped.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const ROLES = ["custodian", "purchaser", "admin"];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;

    for (const role of ROLES) {
      const result = await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, created_at)
         SELECT r.id, 'urgent_items', $2
         FROM roles r
         WHERE lower(r.name) = lower($1)
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_key = 'urgent_items'
           )`,
        [role, now]
      );
      inserted += result.rowCount ?? 0;
      console.log(`OK: "${role}" urgent_items permission (${result.rowCount ? "granted" : "already present or role missing"})`);
    }

    console.log(`\nurgent_items permission backfill completed successfully! (${inserted} row(s) inserted)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
