/**
 * ARCH: Idempotent one-time bulk import (run via `npm run migrate:add-departments`).
 * Seeds the Department option list (kind='department' in option_lists — see
 * the ARCH note on database/schema.ts's optionLists) with the department
 * codes that were previously hardcoded in the client (constants/departments.ts,
 * AdminDashboard.tsx's Create/Edit User form). Safe to re-run: an existing
 * (kind, value) pair is left alone except for backfilling a missing
 * description, never overwritten or duplicated.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const DEPARTMENTS: Array<[code: string, description: string]> = [
  ["ACCTG", "Accounting"],
  ["QA", "Quality Assurance"],
  ["ENGG", "Engineering"],
  ["HR", "Human Resources"],
  ["PRODN", "Production"],
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;
    let backfilled = 0;

    for (const [code, description] of DEPARTMENTS) {
      const value = code.toUpperCase();

      const insertResult = await pool.query(
        `INSERT INTO option_lists (kind, value, description, created_at)
         SELECT 'department', $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM option_lists WHERE kind = 'department' AND upper(value) = upper($1)
         )`,
        [value, description, now]
      );
      if ((insertResult.rowCount ?? 0) > 0) {
        inserted += 1;
        continue;
      }

      const backfillResult = await pool.query(
        `UPDATE option_lists SET description = $2
         WHERE kind = 'department' AND upper(value) = upper($1) AND description IS NULL`,
        [value, description]
      );
      backfilled += backfillResult.rowCount ?? 0;
    }

    console.log(`OK: department seed (${inserted} inserted, ${backfilled} backfilled, ${DEPARTMENTS.length - inserted - backfilled} already up to date)`);
    console.log("\nDepartment migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
