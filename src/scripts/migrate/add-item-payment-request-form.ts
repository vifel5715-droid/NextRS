/**
 * ARCH: Idempotent table migration (run via
 * `npm run migrate:add-item-payment-request-form`).
 *
 * "Urgent Item From IRS" page — adds the item_payment_request_forms table
 * (one per Item Request, F-ACC-003 header/signature fields — see schema.ts's
 * ARCH note on itemPaymentRequestForms). Mirrors add-payment-request-form.ts
 * for the separate Urgent Request workflow's payment_request_forms table.
 * New installs already get it via `npm run init-db` (database/tables.ts,
 * shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const table = TABLE_STATEMENTS.find((t) => t.label === "item_payment_request_forms");
    if (table) {
      await pool.query(table.sql);
      console.log(`OK: ${table.label} table (created or already present)`);
    }

    const indexes = INDEX_STATEMENTS.filter((i) => i.label.startsWith("item_payment_request_forms."));
    for (const index of indexes) {
      await pool.query(index.sql);
      console.log(`OK: ${index.label} (created or already present)`);
    }

    console.log("\nItem Payment Request Form migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
