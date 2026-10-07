/**
 * ARCH: One-time DESTRUCTIVE replacement (run via `npm run migrate:replace-item-catalog-2026-09`).
 * Wipes item_catalog entirely and repopulates it from the September 2026
 * master list (data/item-catalog-2026-09.json — 1204 rows, parsed from the
 * plant's updated item list spreadsheet). Explicitly requested as a full
 * replace rather than an additive merge (unlike
 * import-item-catalog-2026-08.ts): any item manually added, edited, or
 * classified (Machine Code, Item Group, non-default Approver Level or
 * Departments) since the last import is discarded along with it.
 *
 * Source rows have no Machine Code column, so it's left null on every row —
 * fill those in per item afterward as needed. Duplicate (item_name, uom)
 * pairs in the source (a few exist, e.g. differing only in Approver Level)
 * keep whichever occurs first; the rest are skipped, same tie-break as
 * import-item-catalog-2026-08.ts.
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
  readFileSync(join(__dirname, "data/item-catalog-2026-09.json"), "utf-8")
);

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const before = await pool.query("SELECT COUNT(*)::int AS count FROM item_catalog");
    console.log(`Existing item_catalog rows: ${before.rows[0].count} — about to be replaced entirely.`);

    await pool.query("TRUNCATE TABLE item_catalog RESTART IDENTITY");
    console.log("Truncated item_catalog.");

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

    console.log(`OK: item_catalog replaced (${inserted} inserted, ${skipped} duplicate rows in source skipped, ${ROWS.length} total in source)`);
    console.log("\nItem catalog replacement completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
