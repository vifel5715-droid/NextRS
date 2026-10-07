/**
 * ARCH: Idempotent column drop (run via `npm run migrate:drop-service-fields`).
 * Removes service_items.service_type and service_items.frequency — the
 * Service Request form no longer collects these fields.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "service_items.service_type", sql: "ALTER TABLE service_items DROP COLUMN IF EXISTS service_type" },
  { label: "service_items.frequency", sql: "ALTER TABLE service_items DROP COLUMN IF EXISTS frequency" },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const m of MIGRATIONS) {
      await pool.query(m.sql);
      console.log(`OK: ${m.label} (dropped or already absent)`);
    }
    console.log("\nColumn drop migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
