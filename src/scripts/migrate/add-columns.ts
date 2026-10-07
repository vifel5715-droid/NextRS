/**
 * ARCH: Idempotent column migration (run via `npm run migrate:add-columns`).
 * Consolidates three previously overlapping scripts:
 *   - migrate-add-rejection-comment.ts  (rejection_comment)
 *   - add-missing-columns.ts            (rejection_comment + item line-item columns)
 *   - migrate-add-pr-service-requests.ts (service pr_number / pr_status)
 * All use ADD COLUMN IF NOT EXISTS, so running repeatedly is safe.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "item_requests.rejection_comment", sql: "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS rejection_comment TEXT" },
  { label: "service_requests.rejection_comment", sql: "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS rejection_comment TEXT" },
  { label: "service_requests.pr_number", sql: "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_number TEXT" },
  { label: "service_requests.pr_status", sql: "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_status TEXT" },
  { label: "service_requests.pr_number_updated_by", sql: "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_number_updated_by UUID" },
  { label: "service_requests.pr_number_updated_at", sql: "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pr_number_updated_at TEXT" },
  { label: "item_request_items.machine_code", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS machine_code TEXT" },
  { label: "item_request_items.issuance_number", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS issuance_number TEXT" },
  { label: "item_request_items.pr_number", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS pr_number TEXT" },
  { label: "item_request_items.delivery_status", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS delivery_status TEXT" },
  { label: "item_request_items.quantity_delivered", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS quantity_delivered INTEGER" },
  { label: "item_request_items.qty_balance", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS qty_balance INTEGER NOT NULL DEFAULT 0" },
  { label: "item_request_items.quantity_out", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS quantity_out INTEGER" },
  // Releases used to share the delivered counter, so seed quantity_out from the
  // OUT audit rows that were actually recorded against each item.
  {
    label: "item_request_items.quantity_out backfill",
    sql: `UPDATE item_request_items i
          SET quantity_out = COALESCE((
            SELECT SUM(a.quantity_issued) FROM item_issuance_audits a
            WHERE a.item_request_item_id = i.id AND a.transaction_type = 'OUT'
          ), 0)
          WHERE i.quantity_out IS NULL`,
  },
  { label: "item_request_items.pr_status", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS pr_status TEXT" },
  { label: "item_request_items.pr_type", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS pr_type TEXT" },
  { label: "item_request_items.hold_edited", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS hold_edited BOOLEAN NOT NULL DEFAULT FALSE" },
  // Custodian/admin-entered deadline for a "URGENT" item — replaces the GR
  // Number field in the UI while the item sits at that status. See
  // db/schema.ts's itemRequestItems.date_needed.
  { label: "item_request_items.date_needed", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS date_needed TEXT" },
  // "Urgent Item From IRS" page — Purchase Order vs Payment Request
  // classification per item, mirroring urgent_request_items. See
  // db/schema.ts's itemRequestItems.purchasing_transaction.
  { label: "item_request_items.purchasing_transaction", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS purchasing_transaction TEXT" },
  { label: "item_request_items.amount", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)" },
  // "Pending Item Entry" page — Payment Request items that are real
  // trackable stock, still needing a matching Item Catalog entry. See
  // db/schema.ts's itemRequestItems.is_inventoriable/catalog_item_name.
  { label: "item_request_items.is_inventoriable", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS is_inventoriable BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "item_request_items.catalog_item_name", sql: "ALTER TABLE item_request_items ADD COLUMN IF NOT EXISTS catalog_item_name TEXT" },
  // "New Item List" page — Item Catalog registration for Inventoriable
  // Urgent Request items. See db/schema.ts's urgentRequestItems.catalog_item_name.
  { label: "urgent_request_items.catalog_item_name", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS catalog_item_name TEXT" },
  // Payment Request Form (F-ACC-003) — manual override for the computed
  // Total Amount Due. See db/schema.ts's paymentRequestForms/
  // itemPaymentRequestForms.total_amount_due.
  { label: "payment_request_forms.total_amount_due", sql: "ALTER TABLE payment_request_forms ADD COLUMN IF NOT EXISTS total_amount_due NUMERIC(12, 2)" },
  { label: "item_payment_request_forms.total_amount_due", sql: "ALTER TABLE item_payment_request_forms ADD COLUMN IF NOT EXISTS total_amount_due NUMERIC(12, 2)" },
  // Petty Cash — Date Received, set alongside Cash Received by AP Officer.
  // See db/schema.ts's pettyCashTransactions.cash_received_at.
  { label: "petty_cash_transactions.cash_received_at", sql: "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS cash_received_at TEXT" },
  // Petty Cash — Name of Receiver, same AP-Officer-only restriction. See
  // db/schema.ts's pettyCashTransactions.receiver_name.
  { label: "petty_cash_transactions.receiver_name", sql: "ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS receiver_name TEXT" },
  // Best-effort backfill: rows currently sitting at PURCHASE/PAYMENT REQUEST
  // status get their pr_type set to match. Rows that already moved on to a
  // later status (e.g. OUT) before this column existed have no record of
  // which type they were — left NULL, same as the pre-migration behavior.
  {
    label: "item_request_items.pr_type backfill",
    sql: `UPDATE item_request_items
          SET pr_type = delivery_status
          WHERE pr_type IS NULL AND delivery_status IN ('PURCHASE REQUEST', 'PAYMENT REQUEST')`,
  },
  { label: "item_issuance_audits", sql: "CREATE TABLE IF NOT EXISTS item_issuance_audits (id SERIAL PRIMARY KEY, item_request_item_id INTEGER NOT NULL, request_id INTEGER NOT NULL, issuance_number TEXT NOT NULL, transaction_type TEXT, quantity_issued INTEGER NOT NULL, remaining_balance INTEGER NOT NULL, custodian_id UUID NOT NULL, custodian_name TEXT NOT NULL, issued_at TEXT NOT NULL)" },
  { label: "item_issuance_audits.transaction_type", sql: "ALTER TABLE item_issuance_audits ADD COLUMN IF NOT EXISTS transaction_type TEXT" },
  // Rows written before the column existed: an OUT release always carries an
  // issuance number, a partial delivery never does, so that classifies the backlog.
  {
    label: "item_issuance_audits.transaction_type backfill",
    sql: "UPDATE item_issuance_audits SET transaction_type = CASE WHEN COALESCE(issuance_number, '') <> '' THEN 'OUT' ELSE 'PARTIAL' END WHERE transaction_type IS NULL",
  },
  { label: "service_items.delivery_status", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS delivery_status TEXT" },
  { label: "service_items.pr_number", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS pr_number TEXT" },
  { label: "service_items.pr_status", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS pr_status TEXT" },
  { label: "service_items.receiving_report_no", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS receiving_report_no TEXT" },
  { label: "service_items.receiving_report_no_updated_by", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS receiving_report_no_updated_by UUID" },
  { label: "service_items.receiving_report_no_updated_at", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS receiving_report_no_updated_at TEXT" },
  { label: "service_items.hold_edited", sql: "ALTER TABLE service_items ADD COLUMN IF NOT EXISTS hold_edited BOOLEAN NOT NULL DEFAULT FALSE" },
  { label: "item_requests.attachment", sql: "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment TEXT" },
  { label: "item_requests.attachment_name", sql: "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS attachment_name TEXT" },
  { label: "deletion_log.recovered_at", sql: "ALTER TABLE deletion_log ADD COLUMN IF NOT EXISTS recovered_at TEXT" },
  { label: "deletion_log.recovered_by", sql: "ALTER TABLE deletion_log ADD COLUMN IF NOT EXISTS recovered_by UUID" },
  { label: "deletion_log.issued_by_name", sql: "ALTER TABLE deletion_log ADD COLUMN IF NOT EXISTS issued_by_name TEXT" },
  // Free-text "who this is actually for" — distinct from created_by (the
  // logged-in account), so a secretary submitting on someone else's behalf
  // (e.g. "JOHN DOE c/o JANE SMITH") can record that without it being
  // silently overwritten by the account holder's own name.
  { label: "item_requests.requested_by", sql: "ALTER TABLE item_requests ADD COLUMN IF NOT EXISTS requested_by TEXT" },
  { label: "service_requests.requested_by", sql: "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS requested_by TEXT" },
  // Who can give the supervisor-stage approval on a request containing this
  // catalog item — see db/schema.ts's itemCatalog.approval_level.
  { label: "item_catalog.approval_level", sql: "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS approval_level TEXT NOT NULL DEFAULT 'SUPERVISOR_OR_MANAGER'" },
  { label: "item_catalog.machine_code", sql: "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS machine_code TEXT" },
  // Comma-separated department codes allowed to request this item — see
  // db/schema.ts's itemCatalog.departments. Null/empty means unrestricted.
  { label: "item_catalog.departments", sql: "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS departments TEXT" },
  { label: "option_lists.description", sql: "ALTER TABLE option_lists ADD COLUMN IF NOT EXISTS description TEXT" },
  // Department of the user who made the adjustment, distinct from
  // adjustment_log.department (the request's own department) — see
  // db/schema.ts's adjustmentLog for the rationale. Existing rows predate
  // this column, so they backfill from the adjuster's (adjusted_by) CURRENT
  // department in the users table — the closest available guess, since the
  // department they were actually in at the time was never recorded. Falls
  // back to the request's department only if that user no longer exists.
  { label: "adjustment_log.adjusted_by_department", sql: "ALTER TABLE adjustment_log ADD COLUMN IF NOT EXISTS adjusted_by_department TEXT" },
  {
    label: "adjustment_log.adjusted_by_department backfill",
    sql: `UPDATE adjustment_log a
          SET adjusted_by_department = COALESCE(u.department, a.department)
          FROM users u
          WHERE a.adjusted_by = u.id AND a.adjusted_by_department IS NULL`,
  },
  // Rows whose adjusted_by user no longer exists at all (the join above found
  // no match) still need a value before the NOT NULL constraint can apply.
  {
    label: "adjustment_log.adjusted_by_department backfill (orphaned)",
    sql: "UPDATE adjustment_log SET adjusted_by_department = department WHERE adjusted_by_department IS NULL",
  },
  { label: "adjustment_log.adjusted_by_department not-null", sql: "ALTER TABLE adjustment_log ALTER COLUMN adjusted_by_department SET NOT NULL" },
  // Reference number for a whole adjustment EVENT (one Save click, which can
  // touch several fields on an item at once) — distinct from request_serial.
  // Left nullable rather than backfilled here: grouping existing rows into
  // the events they came from needs more than a single UPDATE (see
  // migrate/backfill-adjustment-serial.ts, run separately and optionally).
  { label: "adjustment_log.adjustment_serial", sql: "ALTER TABLE adjustment_log ADD COLUMN IF NOT EXISTS adjustment_serial TEXT" },
  { label: "adjustment_log.request_type", sql: "ALTER TABLE adjustment_log ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'item'" },
  // View/Edit split for the Roles admin screen's page-access checkboxes —
  // see db/schema.ts's rolePermissions. Existing rows default to FALSE,
  // i.e. every previously-granted page starts view-only until an admin
  // re-checks Edit for it.
  { label: "role_permissions.can_edit", sql: "ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE" },
  // Item Catalog — Item Group, mirroring the external accounting system's
  // own Item Group field. See db/schema.ts's itemCatalog.item_group.
  { label: "item_catalog.item_group", sql: "ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS item_group TEXT" },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const m of MIGRATIONS) {
      await pool.query(m.sql);
      console.log(`OK: ${m.label} (added or already present)`);
    }
    console.log("\nColumn migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
