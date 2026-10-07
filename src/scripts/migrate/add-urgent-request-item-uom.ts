/**
 * ARCH: Idempotent column migration (run via
 * `npm run migrate:add-urgent-request-item-uom`).
 * Adds the free-style UoM field to urgent_request_items. New installs
 * already get it via `npm run init-db` (database/tables.ts, shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query("ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS uom TEXT");
    console.log("OK: urgent_request_items.uom");

    console.log("\nUrgent request item UoM migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
