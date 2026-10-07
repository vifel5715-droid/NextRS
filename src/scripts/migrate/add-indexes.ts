/**
 * ARCH: Idempotent index creation (run via `npm run migrate:add-indexes`).
 * Speeds up the department/status filters used by every list endpoint and
 * the request_id lookups used by every detail/child-row query.
 *
 * The statements live in db/indexes.ts, shared with `npm run init-db`, so a
 * fresh database and a migrated one end up with the same indexes.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const m of INDEX_STATEMENTS) {
      await pool.query(m.sql);
      console.log(`OK: ${m.label} (created or already present)`);
    }
    console.log("\nIndex migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
