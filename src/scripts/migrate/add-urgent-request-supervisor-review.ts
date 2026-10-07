/**
 * ARCH: Idempotent column migration (run via
 * `npm run migrate:add-urgent-request-supervisor-review`).
 *
 * Adds the Supervisor/Manager review stage to Urgent Requests — mirroring
 * item_requests' existing Supervisor→Custodian order, Stockroom
 * (stockroom_status) now only acts once supervisor_status is "approved".
 * ADD COLUMN IF NOT EXISTS, so safe to re-run; existing rows default to
 * supervisor_status='pending', same as a brand-new request, since none of
 * them have been supervisor-reviewed yet.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "urgent_requests.supervisor_status", sql: "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS supervisor_status TEXT NOT NULL DEFAULT 'pending'" },
  { label: "urgent_requests.supervisor_approved_by", sql: "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS supervisor_approved_by UUID" },
  { label: "urgent_requests.supervisor_approved_at", sql: "ALTER TABLE urgent_requests ADD COLUMN IF NOT EXISTS supervisor_approved_at TEXT" },
  { label: "urgent_requests_supervisor_status_idx", sql: "CREATE INDEX IF NOT EXISTS urgent_requests_supervisor_status_idx ON urgent_requests (supervisor_status)" },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const { label, sql } of MIGRATIONS) {
      await pool.query(sql);
      console.log(`OK: ${label}`);
    }

    console.log("\nUrgent request supervisor-review migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
