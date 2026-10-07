/**
 * ARCH: Idempotent one-time bulk import (run via `npm run migrate:import-item-catalog-2026-08`).
 * Seeds item_catalog with the plant's full item list (item name / UoM /
 * approver level / departments), extracted from the August 2026 catalog
 * spreadsheet. Data lives in ./data/item-catalog-2026-08.json rather than
 * inline (unlike the smaller MACHINE_CODES/UOM_SEED arrays elsewhere in this
 * folder) simply because it's 6,000+ rows — too large to read comfortably as
 * a literal.
 *
 * The source spreadsheet's own item codes (COMP001, RMBARPIPE-00001, etc.)
 * are NOT imported — item_catalog has no column for them (see db/schema.ts),
 * so they're dropped here rather than folded into item_name and changing
 * what shows up in the app's item-request/search UI.
 *
 * Safe to re-run: matches existing rows by case-insensitive (item_name, uom)
 * and skips them, so a second run only inserts whatever's still missing.
 */
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { env } from "../../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CatalogRow {
  item_name: string;
  uom: string;
  approval_level: "MANAGER_ONLY" | "SUPERVISOR_OR_MANAGER";
  departments: string | null;
}

const ROWS: CatalogRow[] = JSON.parse(
  readFileSync(join(__dirname, "data/item-catalog-2026-08.json"), "utf-8")
);

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;
    let skipped = 0;

    for (const row of ROWS) {
      const result = await pool.query(
        `INSERT INTO item_catalog (item_name, uom, approval_level, departments, created_at)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM item_catalog
           WHERE upper(item_name) = upper($1) AND upper(coalesce(uom, '')) = upper($2)
         )`,
        [row.item_name, row.uom, row.approval_level, row.departments, now]
      );
      if ((result.rowCount ?? 0) > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }

    console.log(`OK: item_catalog import (${inserted} inserted, ${skipped} already present, ${ROWS.length} total in source)`);
    console.log("\nItem catalog import completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
