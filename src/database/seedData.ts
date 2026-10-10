import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { ITEM_TYPE_OPTIONS } from "../constants/itemType.js";
import { UOM_OPTIONS } from "../constants/uom.js";

interface CatalogRow {
  item_name: string;
  uom: string;
  approval_level: "MANAGER_ONLY" | "SUPERVISOR_OR_MANAGER";
  departments: string | null;
}

const catalogRows = JSON.parse(
  readFileSync(fileURLToPath(new URL("./data/item-catalog-2026-09.json", import.meta.url)), "utf8")
) as CatalogRow[];

const MACHINE_CODES: Array<[code: string, description: string]> = [
  ["AGITATOR", "Agitator 1"], ["AGITATOR 2", "Agitator 2"], ["AGITATOR 3", "Agitator 3 Marine"],
  ["ATLAS COPCO", "Air Compressor 1"], ["ATLAS COPCO 2", "Air Compressor 2"],
  ["BAND SEALER", "Band Sealer 1 siomai"], ["BAND SEALER 2", "Band Sealer 2"], ["BAND SEALER 3", "Band Sealer 3"],
  ["BANDSAW", "Bandsaw Machine Laminerva"], ["BLENDER 1", "Blender Inotec 1"], ["BLENDER 2", "Blender Inotec 2"],
  ["BLENDER 3", "Blender Inotec Curing 3"], ["BOILER", "Boiler Biomass ( Combi )"], ["BOILER STANDARD", "Boiler Standard"],
  ["BOWL CUTTER", "Bowl Cutter 200"], ["BOWL CUTTER 2", "Bowl Chopper 325lit 2"], ["CAN WASHER", "Can Washer 1"],
  ["CAN WASHER 2", "Can Washer 2"], ["CAN WASHER 3", "Can Washer 3"], ["CHEM STORAGE", "Chemical Storage"],
  ["CONSUMABLES / COMMON", "Consumables/Common"], ["CONVEYOR", "Table Top Conveyor"], ["COOKER", "Seydelmann Cooker 1"],
  ["COOKER 2", "Seydelmann Cooker 2"], ["COOKER 3", "Seydelmann Cooker 3"], ["COOLING TOWER", "Cooling Tower 1"],
  ["COOLING TOWER 2", "Cooling Tower 2"], ["CRATES WASHER", "Crates Washer"], ["DEEPWELL2", "Deep well 2"],
  ["DEEPWELL4", "Deep Well 4"], ["DOUGH MIXER", "Dough Mixer-Siomai"], ["FLAKER", "Meat Flaker"],
  ["FLRSCLE", "Floor Scale 3 tons"], ["FORKLIFT DIESEL", "Mitsubishi 3 Tons Ground Foklift"],
  ["FORKLIFT DOOSAN", "Electric Reach Truck 1"], ["FORKLIFT DOOSAN 2", "Electric Reach Truck 2"],
  ["FORKLIFT LINDE", "Linde Reach Truck"], ["GENSET", "Caterpillar Genset"], ["GRINDER", "Seydelmann Grinder 1"],
  ["GRINDER 2", "Seydelmann Grinder 2"], ["GRINDER BIRO", "Biro Grinder"], ["HASHER", "Hasher Machine"],
  ["HEMA", "Hema Filler 1"], ["HEMA 2", "Hema Filler 2"], ["HITACHI INKJET", "Hitachi Inkjet Printer 1"],
  ["HITACHI INKJET 2", "Hitachi Inkjet 2"], ["HITACHI INKJET 3", "Hitachi Inkjet 3 Siomai"],
  ["ICE MAKER", "Ice Maker"], ["ICE MAKER NEW", "Ice Maker New-Importation"], ["JACKLIFT", "Jacklift / Handpallet"],
  ["KETTLE", "Steam Jacketed Kettle 1"], ["KETTLE 3", "Steam Jacketed Kettle 3"],
  ["KETTLE NEW", "Steam Jacketed Kettle 2"], ["LABELLING", "Labelling Machine 1"],
  ["LABELLING 2", "Labelling Machine 2"], ["LABELLING SIO", "Labelling Machine 3"], ["LATHE", "Lathe Machine"],
  ["LAZY SUSAN", "Lazy Susan Conveyor 1"], ["LAZY SUSAN 2", "Lazy Susan Conveyor 2"],
  ["LAZY SUSAN 3", "Lazy Susan Conveyor 3"], ["LAZY SUSAN 4", "Lazy Susan Conveyor 4"],
  ["LAZY SUSAN 5", "Lazy Susan Conveyor 5"], ["LAZY SUSAN 6", "Lazy Susan Conveyor 6"],
  ["LAZY SUSAN 7", "Lazy Susan Conveyor 7"], ["LINK CUTTER", "Link Cutter Machine"], ["LOG SPLITTER", "Log Splitter"],
  ["MARINE", "Marine Machineries"], ["METAL DETECTOR", "Metal Detector Loma 1"],
  ["METAL DETECTOR 2", "Metal Detector Loma 2"], ["METAL DETECTOR 3", "Metal Detector Now System 3"],
  ["METAL DETECTOR 4", "Metal Detector Loma 4"], ["METAL DETECTOR 5", "Metal Detector Baoji- 5 ( Siomai )"],
  ["MINI BOILER", "Vertical Type Boiler"], ["MIXER", "Seydelmann Mixer 1"], ["MIXER 2", "Seydelmann Mixer 2"],
  ["MIXER 3", "Seydelmann Mixer 3"], ["NONE", "None"], ["R.O.", "Reverse Osmosis 1"], ["R.O. 2", "Reverse Osmosis 2"],
  ["RETORT", "Retort Vessel 1"], ["RETORT 2", "Retort Vessel 2"], ["RETORT 3", "Retort Vessel 3"],
  ["RETORT 4", "Retort Vessel 4"], ["RETORT 5", "Retort Vessel 5"], ["RETORT 6", "Retort Vessel 6"],
  ["RETORT 7", "Retort Vessel 7"], ["RETORT 8", "Retort Vessel 8"], ["RETORT 9", "Retort Vessel 9"],
  ["RIBBON MIXER", "Ribbo Mixer siomai"], ["SEALER", "Vacuum Sealer"], ["SEAMER", "Seamer Machines"],
  ["SIOMAI FORMER", "Siomai Machine 1"], ["SIOMAI FORMER 0", "Imported Machine 3 layer Siomai Former"],
  ["SIOMAI FORMER 2", "Siomai Machine 2"], ["SIOMAI FORMER 3", "Siomai Machine 3"],
  ["SIOMAI FORMER 4", "Siomai Machine 4"], ["SIOMAI FORMER 5", "Siomai Machine 5"],
  ["SIOMAI FORMER 6", "Siomai Machine 6"], ["SIOMAI FORMER 7", "Siomai Machine 7"],
  ["SIOMAI STEAMER", "Steamer Cabinet 1"], ["SIOMAI STEAMER 2", "Steamer Cabinet 2"],
  ["SIOMAI STEAMER 3", "Steamer Cabinet 3"], ["SMOKEHOUSE", "Smokehouse"], ["SORTING CONVEYOR", "Sorting Conveyor"],
  ["STUFFING", "Stuffing Machine"], ["TRAY", "Siomai Tray"], ["TROLLEYS/CART", "Trolleys & Cart"],
  ["WALK IN CHILLER", "Walk In Chiller"], ["WATER TANK OLD", "Water Tank Old"],
  ["WATER TANK PROJECT", "Water Tank"], ["WEIGHING SCALE", "Table Top Weighing Scale"],
  ["WOOD CHIPPER", "Wood Chipper"], ["WWTP", "Waste Water"],
];

const ITEM_GROUPS = [
  "ACCRUED OTHER EXPENS", "ADVANCES TO VIFEL M", "ANGLEBARPIPE FITTING", "BEARINGS & OILSEAL",
  "BLADE,CHAINS&BELT", "Blast Charge", "BOLTS, NUTS & DISC", "Cartooning Charge", "CDO TOLL FEE",
  "CDO TOLL FEE MARINE", "CDO TOLL FEE SIOMAI", "CONSTRUCT MATERIALS", "CONSUMABLES&UNIFORM",
  "DELIVERY CHARGE", "Dispatch Charge", "ELECTRICALS & WIRING", "EXPENSED ASSET", "Handling Charge",
  "Harvesting Charge", "Holding Charge", "HR Office Expenses", "IMPORT STAG", "INSURANCE", "INSURANCE-001",
  "IPA,FUEL,DIESEL", "Items", "LABOR/SERVICE CHARGE", "Layering Charge", "LUBRICANTS & FILTERS",
  "Maintenance Supplies", "OFFICE FURNITURE", "Office Supplies", "Other Charge", "PAINTS & BRUSH",
  "PLANT MACHINERY SIO", "PLANT MACHINERY-CANN", "PLANT MACHINERY-MARI", "Plug in Charge",
  "Processing Charge", "Rentals", "sanitation", "SANITATION AND ANA", "SFCM Office Supplies",
  "SMALL TOOLS", "SPARE PARTS & OTHERS", "Storage Supplies", "Transpo Vehicle", "Warehouse Inventory",
] as const;

const DEPARTMENTS: Array<[code: string, description: string]> = [
  ["ACCTG", "Accounting"], ["QA", "Quality Assurance"], ["ENGG", "Engineering"],
  ["HR", "Human Resources"], ["PRODN", "Production"],
];

async function seedOption(
  pool: Pool,
  kind: string,
  value: string,
  description: string | null = null
): Promise<void> {
  const createdAt = new Date().toISOString();
  const inserted = await pool.query(
    `INSERT INTO option_lists (kind, value, description, created_at)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM option_lists WHERE kind = $1 AND upper(value) = upper($2)
     )
     ON CONFLICT DO NOTHING`,
    [kind, value.toUpperCase(), description, createdAt]
  );
  if (!inserted.rowCount && description !== null) {
    await pool.query(
      `UPDATE option_lists SET description = $3
       WHERE kind = $1 AND upper(value) = upper($2) AND description IS NULL`,
      [kind, value, description]
    );
  }
}

async function importItemCatalog(pool: Pool): Promise<void> {
  if (
    !Array.isArray(catalogRows) ||
    catalogRows.some(
      (row) =>
        typeof row.item_name !== "string" ||
        typeof row.uom !== "string" ||
        !["MANAGER_ONLY", "SUPERVISOR_OR_MANAGER"].includes(row.approval_level) ||
        (row.departments !== null && typeof row.departments !== "string")
    )
  ) {
    throw new Error("The bundled item catalog contains invalid rows.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("LOCK TABLE item_catalog IN SHARE ROW EXCLUSIVE MODE");
      const result = await client.query(
        `WITH source AS (
           SELECT
             payload->>'item_name' AS item_name,
             payload->>'uom' AS uom,
             payload->>'approval_level' AS approval_level,
             payload->>'departments' AS departments,
             ordinality,
             ROW_NUMBER() OVER (
               PARTITION BY upper(payload->>'item_name'), upper(coalesce(payload->>'uom', ''))
               ORDER BY ordinality
             ) AS duplicate_number
           FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS entries(payload, ordinality)
         )
         INSERT INTO item_catalog (item_name, uom, approval_level, departments, created_at)
         SELECT source.item_name, source.uom, source.approval_level, source.departments, $2
         FROM source
         WHERE source.duplicate_number = 1
           AND NOT EXISTS (
             SELECT 1 FROM item_catalog existing
             WHERE upper(existing.item_name) = upper(source.item_name)
               AND upper(coalesce(existing.uom, '')) = upper(coalesce(source.uom, ''))
           )`,
        [JSON.stringify(catalogRows), new Date().toISOString()]
      );
      await client.query("COMMIT");
      console.log(`OK: item catalog seed (${result.rowCount ?? 0} added; existing entries retained)`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function seedReferenceData(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  for (const [code, name] of [
    ["ACCTG", "Accounting"], ["HR", "Human Resources"], ["QA", "Quality Assurance"],
    ["ENGG", "Engineering"], ["PRODNCAN", "Production Canning"], ["PRODSIO", "Production Siomai"],
    ["PRODNMAR", "Production Marine"], ["PRODNHOT", "Production Hotdog"],
  ]) {
    await pool.query(
      "INSERT INTO departments (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING",
      [code, name]
    );
  }

  await importItemCatalog(pool);

  for (const value of ITEM_TYPE_OPTIONS.filter((value) => value !== "OTHER")) {
    await seedOption(pool, "item_type", value);
  }
  for (const value of UOM_OPTIONS.filter((value) => value !== "OTHER")) {
    await seedOption(pool, "uom", value);
  }
  for (const [code, description] of DEPARTMENTS) {
    await seedOption(pool, "department", code, description);
  }
  for (const group of ITEM_GROUPS) {
    await seedOption(pool, "item_group", group);
  }
  for (const [code, description] of MACHINE_CODES) {
    await seedOption(pool, "machine_code", code, description);
  }

  const catalogUoms = await pool.query(
    `INSERT INTO option_lists (kind, value, created_at)
     SELECT DISTINCT 'uom', upper(trim(c.uom)), $1
     FROM item_catalog c
     WHERE coalesce(trim(c.uom), '') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM option_lists o
         WHERE o.kind = 'uom' AND upper(o.value) = upper(trim(c.uom))
       )`,
    [now]
  );
  console.log(`OK: reference data seeded (catalog UoMs added: ${catalogUoms.rowCount ?? 0})`);
}
