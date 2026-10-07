/**
 * ARCH: One-time additive migration (run via `npm run migrate:add-petty-cash-serial`).
 * Adds petty_cash_transactions.serial ("PC-2026-000001", same generated-serial
 * convention as every other request type — see shared/utils/serial.ts's
 * withSerial) for installs that predate the column. Existing rows have no
 * serial yet, so this backfills them in creation order (oldest first) before
 * adding the NOT NULL + UNIQUE constraints — a plain ADD COLUMN NOT NULL
 * would fail outright with existing rows present.
 * Safe to re-run: already-serialed rows are left untouched, and adding
 * constraints that already exist is a no-op.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query("ALTER TABLE petty_cash_transactions ADD COLUMN IF NOT EXISTS serial TEXT");
    console.log("OK: petty_cash_transactions.serial column (added or already present)");

    const { rows } = await pool.query<{ id: number; created_at: string }>(
      "SELECT id, created_at FROM petty_cash_transactions WHERE serial IS NULL ORDER BY created_at ASC, id ASC"
    );

    const countByYear = new Map<number, number>();
    // Seed each year's counter from any already-serialed rows so a re-run
    // (or a mix of backfilled + newly created rows) never reuses a number.
    const { rows: existing } = await pool.query<{ serial: string }>(
      "SELECT serial FROM petty_cash_transactions WHERE serial IS NOT NULL AND serial LIKE 'PC-%'"
    );
    for (const { serial } of existing) {
      const match = serial.match(/^PC-(\d{4})-(\d+)$/);
      if (!match) continue;
      const year = Number(match[1]);
      const num = Number(match[2]);
      countByYear.set(year, Math.max(countByYear.get(year) ?? 0, num));
    }

    let backfilled = 0;
    for (const { id, created_at } of rows) {
      const year = new Date(created_at).getFullYear();
      const next = (countByYear.get(year) ?? 0) + 1;
      countByYear.set(year, next);
      const serial = `PC-${year}-${String(next).padStart(6, "0")}`;
      await pool.query("UPDATE petty_cash_transactions SET serial = $1 WHERE id = $2", [serial, id]);
      backfilled += 1;
    }
    console.log(`OK: backfilled serial on ${backfilled} existing row(s)`);

    await pool.query("ALTER TABLE petty_cash_transactions ALTER COLUMN serial SET NOT NULL");
    console.log("OK: petty_cash_transactions.serial set NOT NULL");

    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE petty_cash_transactions ADD CONSTRAINT petty_cash_transactions_serial_unique UNIQUE (serial);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log("OK: petty_cash_transactions.serial UNIQUE constraint (added or already present)");

    console.log("\nPetty Cash serial migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
