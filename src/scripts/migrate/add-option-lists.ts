/**
 * ARCH: Idempotent table + index creation (run via `npm run migrate:add-option-lists`),
 * plus a one-time backfill from the constants that used to be the only source
 * of Item Type / UoM options (client/src/constants/itemType.ts, uom.ts).
 * New installs get the table via `npm run init-db` (db/tables.ts, shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";

// Mirrors client/src/constants/itemType.ts and uom.ts, minus their "OTHER"
// sentinel entries — SearchableCombobox has no use for a literal "OTHER" row
// now that typing a custom value works directly.
const ITEM_TYPE_SEED = [
  "ANGLEBARPIPE FITTING", "BEARINGS & OILSEAL", "BLADE,CHAINS&BELT", "BOLTS, NUTS & DISC",
  "CARTOONING CHARGE", "CONSTRUCT MATERIALS", "CONSUMABLES&UNIFORM", "ELECTRICALS & WIRING",
  "EXPENSED ASSET", "IMPORT STAG", "IPA,FUEL,DIESEL", "ITEMS", "MAINTENANCE SUPPLIES",
  "OFFICE FURNITURE", "OFFICE SUPPLIES", "OTHER CHARGE", "PAINTS & BRUSH", "RENTALS",
  "SFCM OFFICE SUPPLIES", "SMALL TOOLS", "SPARE PARTS & OTHERS",
];
const UOM_SEED = [
  "PC", "BOX/ES", "CAN/S", "CASE", "CRBY/S", "CYL", "DOZ", "DRUM/S", "ELF", "FT", "GAL/S",
  "GLOVES", "ITM", "KG/S", "KILO/S", "LENGTH", "LITER/S", "METER/S", "PACK/S", "PAD/S",
  "PAIL/S", "PAIR/S", "REAM/S", "ROLL/S", "SACK/S", "SET/S", "TANK/S", "TINS", "UNIT/S",
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const table = TABLE_STATEMENTS.find((t) => t.label === "option_lists");
    if (table) {
      await pool.query(table.sql);
      console.log(`OK: ${table.label} table (created or already present)`);
    }

    const indexes = INDEX_STATEMENTS.filter((i) => i.label.startsWith("option_lists."));
    for (const index of indexes) {
      await pool.query(index.sql);
      console.log(`OK: ${index.label} (created or already present)`);
    }

    const now = new Date().toISOString();
    for (const [kind, values] of [["item_type", ITEM_TYPE_SEED], ["uom", UOM_SEED]] as const) {
      let inserted = 0;
      for (const value of values) {
        const result = await pool.query(
          `INSERT INTO option_lists (kind, value, created_at)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM option_lists WHERE kind = $1 AND upper(value) = upper($2)
           )`,
          [kind, value, now]
        );
        inserted += result.rowCount ?? 0;
      }
      console.log(`OK: ${kind} seed (${inserted} of ${values.length} inserted, rest already present)`);
    }

    // Catalog imports (import-item-catalog-2026-08 / replace-item-catalog-2026-09)
    // write item_catalog.uom directly, so UoMs they introduced (KILOGRAM,
    // BOTTLE/S, …) never reached the UoM list — backfill them as suggestions too.
    const catalogUoms = await pool.query(
      `INSERT INTO option_lists (kind, value, created_at)
       SELECT DISTINCT 'uom', upper(trim(c.uom)), $1
       FROM item_catalog c
       WHERE coalesce(trim(c.uom), '') <> ''
         AND NOT EXISTS (
           SELECT 1 FROM option_lists o WHERE o.kind = 'uom' AND upper(o.value) = upper(trim(c.uom))
         )`,
      [now]
    );
    console.log(`OK: uom backfill from item_catalog (${catalogUoms.rowCount ?? 0} inserted)`);

    console.log("\nOption lists migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
