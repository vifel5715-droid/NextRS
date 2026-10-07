/**
 * ARCH: One-time correction (run via `npm run migrate:fix-adjustment-log-department`).
 *
 * The very first version of the adjusted_by_department backfill (see
 * add-columns.ts) copied the REQUEST's department into every existing row
 * instead of looking up who actually made the adjustment — so a custodian
 * who adjusted a different department's request showed that department
 * instead of their own. add-columns.ts's backfill now joins against users
 * correctly, but it only fills NULLs, so any row already wrongly populated
 * by the old logic needs this unconditional re-sync once.
 *
 * Re-derives every row's adjusted_by_department from the adjuster's CURRENT
 * users.department — safe to run more than once (each run just re-confirms
 * the same current value unless the user's own department changed since).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const result = await pool.query(`
      UPDATE adjustment_log a
      SET adjusted_by_department = u.department
      FROM users u
      WHERE a.adjusted_by = u.id AND a.adjusted_by_department IS DISTINCT FROM u.department
    `);
    console.log(`OK: corrected ${result.rowCount} adjustment_log row(s) to their adjuster's current department`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
