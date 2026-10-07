/**
 * ARCH: Idempotent one-time bulk import (run via `npm run migrate:add-item-groups`).
 * Seeds the Item Group option list (kind='item_group' in option_lists — see
 * the ARCH note on db/schema.ts's optionLists) with the external accounting
 * system's own Item Group list, so the Item Catalog form's Item Group field
 * offers the same choices from day one instead of building up from scratch
 * as people type. Safe to re-run: an existing (kind, value) pair is left
 * alone, never duplicated.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const ITEM_GROUPS: string[] = [
  "ACCRUED OTHER EXPENS",
  "ADVANCES TO VIFEL M",
  "ANGLEBARPIPE FITTING",
  "BEARINGS & OILSEAL",
  "BLADE,CHAINS&BELT",
  "Blast Charge",
  "BOLTS, NUTS & DISC",
  "Cartooning Charge",
  "CDO TOLL FEE",
  "CDO TOLL FEE MARINE",
  "CDO TOLL FEE SIOMAI",
  "CONSTRUCT MATERIALS",
  "CONSUMABLES&UNIFORM",
  "DELIVERY CHARGE",
  "Dispatch Charge",
  "ELECTRICALS & WIRING",
  "EXPENSED ASSET",
  "Handling Charge",
  "Harvesting Charge",
  "Holding Charge",
  "HR Office Expenses",
  "IMPORT STAG",
  "INSURANCE",
  "INSURANCE-001",
  "IPA,FUEL,DIESEL",
  "Items",
  "LABOR/SERVICE CHARGE",
  "Layering Charge",
  "LUBRICANTS & FILTERS",
  "Maintenance Supplies",
  "OFFICE FURNITURE",
  "Office Supplies",
  "Other Charge",
  "PAINTS & BRUSH",
  "PLANT MACHINERY SIO",
  "PLANT MACHINERY-CANN",
  "PLANT MACHINERY-MARI",
  "Plug in Charge",
  "Processing Charge",
  "Rentals",
  "sanitation",
  "SANITATION AND ANA",
  "SFCM Office Supplies",
  "SMALL TOOLS",
  "SPARE PARTS & OTHERS",
  "Storage Supplies",
  "Transpo Vehicle",
  "Warehouse Inventory",
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;

    for (const group of ITEM_GROUPS) {
      const value = group.toUpperCase();
      const insertResult = await pool.query(
        `INSERT INTO option_lists (kind, value, created_at)
         SELECT 'item_group', $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM option_lists WHERE kind = 'item_group' AND upper(value) = upper($1)
         )`,
        [value, now]
      );
      inserted += insertResult.rowCount ?? 0;
    }

    console.log(`OK: item_group seed (${inserted} inserted, ${ITEM_GROUPS.length - inserted} already present)`);
    console.log("\nItem Group migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
