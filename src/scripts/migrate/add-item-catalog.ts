/**
 * ARCH: Idempotent table creation (run via `npm run migrate:add-item-catalog`).
 * Adds the item_catalog table for existing databases that predate it — new
 * installs already get it via `npm run init-db` (db/tables.ts, shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const table = TABLE_STATEMENTS.find((t) => t.label === "item_catalog");
    if (table) {
      await pool.query(table.sql);
      console.log(`OK: ${table.label} table (created or already present)`);
    }

    console.log("\nItem catalog migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
