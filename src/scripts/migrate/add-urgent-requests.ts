/**
 * ARCH: Idempotent table + index creation (run via `npm run migrate:add-urgent-requests`).
 * Adds the urgent_requests and urgent_request_items tables for existing
 * databases that predate them — new installs already get them via
 * `npm run init-db` (database/tables.ts, shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const label of ["urgent_requests", "urgent_request_items"]) {
      const table = TABLE_STATEMENTS.find((t) => t.label === label);
      if (table) {
        await pool.query(table.sql);
        console.log(`OK: ${table.label} table (created or already present)`);
      }
    }

    const indexes = INDEX_STATEMENTS.filter((i) => i.label.startsWith("urgent_request"));
    for (const index of indexes) {
      await pool.query(index.sql);
      console.log(`OK: ${index.label} (created or already present)`);
    }

    console.log("\nUrgent requests migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
