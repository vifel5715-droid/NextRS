/**
 * ARCH: Destructive maintenance script (run via `npm run drop-tables`).
 * Drops EVERY table in the public schema — structure and data, including the
 * users and departments reference data. Pairs with `npm run init-db`, which
 * recreates the tables and reseeds the defaults.
 *
 * Use `npm run clear-requests` instead if you only want to wipe request data:
 * that keeps the tables and the users/departments rows.
 *
 * Tables are discovered from pg_tables rather than hardcoded, so this cannot
 * fall behind the schema, and it also removes anything left over from older
 * migrations. CASCADE resolves the foreign keys, so drop order does not matter.
 */
import { Pool } from "pg";
import { env } from "../src/lib/env";

const CONFIRM_FLAG = "--yes";

async function main() {
  const confirmed = process.argv.includes(CONFIRM_FLAG) || process.env.CONFIRM_DROP === "yes";

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );

    if (rows.length === 0) {
      console.log("No tables found in the public schema — nothing to drop.");
      process.exit(0);
    }

    const tables = rows.map((r) => r.tablename);

    console.log(`Found ${tables.length} table(s) in the public schema:\n`);
    for (const table of tables) {
      const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      console.log(`  ${table}: ${countRows[0].count} row(s)`);
    }

    // Dropping every table cannot be undone, and this script is one command away
    // from whatever DATABASE_URL happens to be set. Require the intent explicitly.
    if (!confirmed) {
      console.log(
        `\nThis will DROP all ${tables.length} table(s) above — data and structure, permanently.` +
          `\nNothing has been changed. To go ahead, re-run with:\n` +
          `\n  npm run drop-tables -- ${CONFIRM_FLAG}\n` +
          `\nRun 'npm run init-db' afterwards to recreate the tables and seed defaults.`
      );
      process.exit(1);
    }

    const quoted = tables.map((t) => `"${t}"`).join(", ");
    await pool.query(`DROP TABLE IF EXISTS ${quoted} CASCADE`);

    console.log(`\nDropped ${tables.length} table(s). Run 'npm run init-db' to recreate them.`);
    process.exit(0);
  } catch (error) {
    console.error("Error dropping tables:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
