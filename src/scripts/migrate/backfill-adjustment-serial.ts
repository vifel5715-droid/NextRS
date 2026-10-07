/**
 * ARCH: Best-effort, one-time backfill (run via `npm run migrate:backfill-adjustment-serial`).
 *
 * adjustment_log rows written before adjustment_serial existed have no
 * reference number. Every row from the same Save click shares the exact same
 * adjusted_at timestamp (see lib/adjustmentLog.ts — it's computed once per
 * call and reused across the whole batch's inserts), so that pairing
 * (request_id, adjusted_at) reliably reconstructs the original save events
 * even after the fact. Assigns serials in chronological order, scoped by the
 * year in adjusted_at — matches nextAdjustmentSerial's per-year numbering.
 * Safe to run more than once: already-serialed rows are left untouched.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ request_id: number | null; adjusted_at: string }>(`
      SELECT DISTINCT request_id, adjusted_at
      FROM adjustment_log
      WHERE adjustment_serial IS NULL
      ORDER BY adjusted_at ASC
    `);

    const countByYear = new Map<number, number>();
    let updated = 0;

    for (const { request_id, adjusted_at } of rows) {
      const year = new Date(adjusted_at).getFullYear();
      const next = (countByYear.get(year) ?? 0) + 1;
      countByYear.set(year, next);
      const serial = `ADJ-${year}-${String(next).padStart(4, "0")}`;

      const result = request_id === null
        ? await pool.query(
            "UPDATE adjustment_log SET adjustment_serial = $1 WHERE request_id IS NULL AND adjusted_at = $2 AND adjustment_serial IS NULL",
            [serial, adjusted_at]
          )
        : await pool.query(
            "UPDATE adjustment_log SET adjustment_serial = $1 WHERE request_id = $2 AND adjusted_at = $3 AND adjustment_serial IS NULL",
            [serial, request_id, adjusted_at]
          );
      updated += result.rowCount ?? 0;
    }

    console.log(`OK: backfilled adjustment_serial on ${updated} row(s) across ${rows.length} event(s)`);
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
