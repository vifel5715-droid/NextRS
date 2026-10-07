/**
 * ARCH: One-time data migration (run via
 * `npm run migrate:rename-payment-request-to-urgent`).
 *
 * Renames the "PAYMENT REQUEST" delivery_status/pr_type value to "URGENT"
 * on item_request_items (and the legacy, currently-unused item_status
 * table, for consistency) — the code-side comparisons were updated in the
 * same change (item-request.service.ts, status.service.ts, and every
 * client dashboard's dropdown/label). This backfills rows that already
 * have the old value stored. "PURCHASE REQUEST" is untouched — it's a
 * separate, distinct status.
 *
 * Idempotent — matches zero rows (safe to re-run) once the rename has
 * already been applied.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "item_request_items.delivery_status", sql: "UPDATE item_request_items SET delivery_status = 'URGENT' WHERE delivery_status = 'PAYMENT REQUEST'" },
  { label: "item_request_items.pr_type", sql: "UPDATE item_request_items SET pr_type = 'URGENT' WHERE pr_type = 'PAYMENT REQUEST'" },
  { label: "item_status.delivery_status", sql: "UPDATE item_status SET delivery_status = 'URGENT' WHERE delivery_status = 'PAYMENT REQUEST'" },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const { label, sql } of MIGRATIONS) {
      const result = await pool.query(sql);
      console.log(`OK: ${label} — ${result.rowCount ?? 0} row(s) updated`);
    }

    console.log("\nPAYMENT REQUEST -> URGENT rename migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
