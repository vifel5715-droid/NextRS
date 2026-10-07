/**
 * ARCH: One-time additive migration (run via `npm run migrate:add-reimbursement-closed-columns`).
 * Adds reimbursement_requests.closed_by / closed_at so AP Officer can mark a
 * fully-approved reimbursement "closed" once the money has actually been
 * disbursed/received (ap_status gains a 4th value, "closed", reachable only
 * from "approved" — see reimbursement-request.service.ts's
 * closeReimbursementRequest). Both columns are nullable, so this is a plain
 * additive change with no backfill needed.
 * Safe to re-run: ADD COLUMN IF NOT EXISTS is a no-op once applied.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query("ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS closed_by UUID");
    console.log("OK: reimbursement_requests.closed_by column (added or already present)");

    await pool.query("ALTER TABLE reimbursement_requests ADD COLUMN IF NOT EXISTS closed_at TEXT");
    console.log("OK: reimbursement_requests.closed_at column (added or already present)");

    console.log("\nReimbursement closed-columns migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
