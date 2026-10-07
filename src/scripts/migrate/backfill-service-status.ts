/**
 * ARCH: One-off data migration (run via `npm run migrate:backfill-service-status`).
 * service_requests used to be created without seeding supervisor_status/
 * custodian_status (left NULL), unlike item_requests which always set them to
 * "pending". That mismatch meant getPendingCount's `eq(status, "pending")`
 * silently excluded any request nobody had touched yet from the sidebar
 * badge, even though the dashboard list itself showed it as needing action.
 * createServiceRequest now seeds both to "pending" like item_requests always
 * has; this backfills rows created before that fix. Idempotent: only touches
 * rows still NULL (i.e. genuinely untouched).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const supervisorResult = await pool.query(
      `UPDATE service_requests SET supervisor_status = 'pending' WHERE supervisor_status IS NULL`
    );
    console.log(`OK: service_requests.supervisor_status backfilled (${supervisorResult.rowCount} row(s))`);

    const custodianResult = await pool.query(
      `UPDATE service_requests SET custodian_status = 'pending' WHERE custodian_status IS NULL`
    );
    console.log(`OK: service_requests.custodian_status backfilled (${custodianResult.rowCount} row(s))`);

    console.log("\nService status backfill completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
