/**
 * ARCH: Idempotent table + index creation (run via `npm run migrate:add-deletion-log`).
 * Adds the deletion_log table for existing databases that predate it — new
 * installs already get it via `npm run init-db` (db/tables.ts, shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const table = TABLE_STATEMENTS.find((t) => t.label === "deletion_log");
    if (table) {
      await pool.query(table.sql);
      console.log(`OK: ${table.label} table (created or already present)`);
    }

    const indexes = INDEX_STATEMENTS.filter((i) => i.label.startsWith("deletion_log."));
    for (const index of indexes) {
      await pool.query(index.sql);
      console.log(`OK: ${index.label} (created or already present)`);
    }

    console.log("\nDeletion log migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
