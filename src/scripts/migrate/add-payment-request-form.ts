/**
 * ARCH: Idempotent column + table migration (run via
 * `npm run migrate:add-payment-request-form`).
 *
 * Purchaser Dashboard, Phase 2/3 — adds the per-item Purchasing Transaction
 * classification (purchase_order | payment_request + amount) to
 * urgent_request_items, and the payment_request_forms table (one per Urgent
 * Request, F-ACC-003 header/signature fields — see schema.ts's ARCH note).
 * New installs already get both via `npm run init-db` (database/tables.ts,
 * shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";

const COLUMN_MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "urgent_request_items.purchasing_transaction", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS purchasing_transaction TEXT" },
  { label: "urgent_request_items.amount", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)" },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const { label, sql } of COLUMN_MIGRATIONS) {
      await pool.query(sql);
      console.log(`OK: ${label}`);
    }

    const table = TABLE_STATEMENTS.find((t) => t.label === "payment_request_forms");
    if (table) {
      await pool.query(table.sql);
      console.log(`OK: ${table.label} table (created or already present)`);
    }

    const indexes = INDEX_STATEMENTS.filter((i) => i.label.startsWith("payment_request_forms."));
    for (const index of indexes) {
      await pool.query(index.sql);
      console.log(`OK: ${index.label} (created or already present)`);
    }

    console.log("\nPayment Request Form migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
