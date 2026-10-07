/**
 * ARCH: Diagnostic script (run via `npm run view-db`).
 * Dumps the contents of every table for inspection.
 */
import { Pool } from "pg";
import { env } from "../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.log("\n=== DATABASE CONTENTS ===\n");

    const tables = [
      ["users", "USERS"],
      ["item_requests", "ITEM REQUESTS"],
      ["item_request_items", "ITEM REQUEST ITEMS"],
      ["service_requests", "SERVICE REQUESTS"],
      ["service_items", "SERVICE ITEMS"],
      ["item_status", "ITEM STATUS"],
      ["service_status", "SERVICE STATUS"], // bug fix: original omitted this table
    ] as const;

    for (const [table, label] of tables) {
      console.log(`\n${label}:`);
      const result = await pool.query(`SELECT * FROM ${table}`);
      console.table(result.rows);
    }
  } catch (error) {
    console.error("Error viewing database:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
