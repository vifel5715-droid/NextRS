/**
 * ARCH: Idempotent column + permission migration (run via
 * `npm run migrate:add-submitted-payment-requests`).
 *
 * "Submitted Payment Request" — adds the submit-then-lock columns
 * (submitted/submitted_by/submitted_at) to payment_request_forms (Urgent
 * Request workflow) and item_payment_request_forms ("Urgent Item From IRS"
 * workflow) — see schema.ts's ARCH note on paymentRequestForms.submitted —
 * and grants the new "submitted_payment_requests" permission key (the
 * sidebar page listing every submitted F-ACC-003 form) to purchaser,
 * ap_officer, operations_manager, and admin. View-only: the actual edit
 * right on a submitted form comes from each role's existing
 * ap_officer_dashboard Edit grant (see urgent-request.service.ts's
 * savePaymentRequestForm), not from this key's own can_edit.
 *
 * New installs already get all of this via `npm run init-db` (database/
 * tables.ts + seedRoles.ts, shared here). Safe to re-run: an existing column
 * or (role, key) grant is left untouched.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const COLUMN_MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "payment_request_forms.submitted", sql: "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS submitted BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "payment_request_forms.submitted_by", sql: "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS submitted_by UUID" },
  { label: "payment_request_forms.submitted_at", sql: "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS submitted_at TEXT" },
  { label: "item_payment_request_forms.submitted", sql: "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS submitted BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "item_payment_request_forms.submitted_by", sql: "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS submitted_by UUID" },
  { label: "item_payment_request_forms.submitted_at", sql: "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS submitted_at TEXT" },
];

const ROLES = ["purchaser", "ap_officer", "operations_manager", "admin"];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const { label, sql } of COLUMN_MIGRATIONS) {
      await pool.query(sql);
      console.log(`OK: ${label}`);
    }

    const now = new Date().toISOString();
    let inserted = 0;
    for (const role of ROLES) {
      const result = await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, created_at)
         SELECT r.id, 'submitted_payment_requests', $2
         FROM roles r
         WHERE lower(r.name) = lower($1)
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_key = 'submitted_payment_requests'
           )`,
        [role, now]
      );
      inserted += result.rowCount ?? 0;
      console.log(`OK: "${role}" submitted_payment_requests permission (${result.rowCount ? "granted" : "already present or role missing"})`);
    }

    console.log(`\nSubmitted Payment Request migration completed successfully! (${inserted} permission row(s) inserted)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
