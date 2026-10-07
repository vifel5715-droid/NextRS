/**
 * ARCH: Idempotent column migration (run via
 * `npm run migrate:add-urgent-request-date-needed`).
 * Adds urgent_requests.date_needed — flows through as the default for the
 * Payment Request Form's own Date Needed field. New installs already get it
 * via `npm run init-db` (database/tables.ts, shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query("ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS date_needed TEXT");
    console.log("OK: urgent_requests.date_needed");

    console.log("\nUrgent request date_needed migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
