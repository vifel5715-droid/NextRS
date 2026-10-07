/**
 * ARCH: Maintenance script (run via `npm run clear-requests`).
 * Wipes all request/status/issuance rows. Tables themselves and the
 * users/departments reference data are preserved.
 *
 * Uses a single TRUNCATE rather than a sequence of DELETEs:
 *   - CASCADE resolves the foreign-key order for us, so the list cannot drift
 *     out of order as tables are added (item_issuance_audits used to be deleted
 *     last, after the parents it references had already cascaded it away).
 *   - RESTART IDENTITY resets the id sequences, so a cleared database starts
 *     from 1 again and matches the serial numbers, which are derived from a
 *     row count and restart on their own.
 *   - It is one atomic statement, so a failure cannot leave the data half-wiped.
 */
import { Pool } from "pg";
import { env } from "../config/env.js";

const TABLES = [
  "item_status",
  "service_status",
  "item_issuance_audits",
  "item_request_items",
  "service_items",
  "item_requests",
  "service_requests",
] as const;

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.log("Clearing all requests from database...\n");

    // Report what is about to go, so the operator sees the scale before it does.
    for (const table of TABLES) {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      console.log(`  ${table}: ${rows[0].count} row(s)`);
    }

    await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);

    console.log("\nAll requests cleared successfully! Users and departments were left intact.");
    process.exit(0);
  } catch (error) {
    console.error("Error clearing requests:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
