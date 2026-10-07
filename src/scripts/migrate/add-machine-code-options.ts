/**
 * ARCH: Idempotent one-time bulk import (run via `npm run migrate:add-machine-codes`).
 * Seeds the Machine Code option list (kind='machine_code' in option_lists —
 * see the ARCH note on db/schema.ts's optionLists) with the plant's full
 * machine code / description reference list. Safe to re-run: an existing
 * (kind, value) pair is left alone except for backfilling a missing
 * description, never overwritten or duplicated.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const MACHINE_CODES: Array<[code: string, description: string]> = [
  ["AGITATOR", "Agitator 1"],
  ["AGITATOR 2", "Agitator 2"],
  ["AGITATOR 3", "Agitator 3 Marine"],
  ["ATLAS COPCO", "Air Compressor 1"],
  ["ATLAS COPCO 2", "Air Compressor 2"],
  ["BAND SEALER", "Band Sealer 1 siomai"],
  ["BAND SEALER 2", "Band Sealer 2"],
  ["BAND SEALER 3", "Band Sealer 3"],
  ["BANDSAW", "Bandsaw Machine Laminerva"],
  ["BLENDER 1", "Blender Inotec 1"],
  ["BLENDER 2", "Blender Inotec 2"],
  ["BLENDER 3", "Blender Inotec Curing 3"],
  ["BOILER", "Boiler Biomass ( Combi )"],
  ["BOILER STANDARD", "Boiler Standard"],
  ["BOWL CUTTER", "Bowl Cutter 200"],
  ["BOWL CUTTER 2", "Bowl Chopper 325lit 2"],
  ["CAN WASHER", "Can Washer 1"],
  ["CAN WASHER 2", "Can Washer 2"],
  ["CAN WASHER 3", "Can Washer 3"],
  ["CHEM STORAGE", "Chemical Storage"],
  ["CONSUMABLES / COMMON", "Consumables/Common"],
  ["CONVEYOR", "Table Top Conveyor"],
  ["COOKER", "Seydelmann Cooker 1"],
  ["COOKER 2", "Seydelmann Cooker 2"],
  ["COOKER 3", "Seydelmann Cooker 3"],
  ["COOLING TOWER", "Cooling Tower 1"],
  ["COOLING TOWER 2", "Cooling Tower 2"],
  ["CRATES WASHER", "Crates Washer"],
  ["DEEPWELL2", "Deep well 2"],
  ["DEEPWELL4", "Deep Well 4"],
  ["DOUGH MIXER", "Dough Mixer-Siomai"],
  ["FLAKER", "Meat Flaker"],
  ["FLRSCLE", "Floor Scale 3 tons"],
  ["FORKLIFT DIESEL", "Mitsubishi 3 Tons Ground Foklift"],
  ["FORKLIFT DOOSAN", "Electric Reach Truck 1"],
  ["FORKLIFT DOOSAN 2", "Electric Reach Truck 2"],
  ["FORKLIFT LINDE", "Linde Reach Truck"],
  ["GENSET", "Caterpillar Genset"],
  ["GRINDER", "Seydelmann Grinder 1"],
  ["GRINDER 2", "Seydelmann Grinder 2"],
  ["GRINDER BIRO", "Biro Grinder"],
  ["HASHER", "Hasher Machine"],
  ["HEMA", "Hema Filler 1"],
  ["HEMA 2", "Hema Filler 2"],
  ["HITACHI INKJET", "Hitachi Inkjet Printer 1"],
  ["HITACHI INKJET 2", "Hitachi Inkjet Printer 2"],
  ["HITACHI INKJET 3", "Hitachi Inkjet 3 Siomai"],
  ["ICE MAKER", "Ice Maker"],
  ["ICE MAKER NEW", "Ice Maker New-Importation"],
  ["JACKLIFT", "Jacklift / Handpallet"],
  ["KETTLE", "Steam Jacketed Kettle 1"],
  ["KETTLE 3", "Steam Jacketed Kettle 3"],
  ["KETTLE NEW", "Steam Jacketed Kettle 2"],
  ["LABELLING", "Labelling Machine 1"],
  ["LABELLING 2", "Labelling Machine 2"],
  ["LABELLING SIO", "Labelling Machine 3"],
  ["LATHE", "Lathe Machine"],
  ["LAZY SUSAN", "Lazy Susan Conveyor 1"],
  ["LAZY SUSAN 2", "Lazy Susan Conveyor 2"],
  ["LAZY SUSAN 3", "Lazy Susan Conveyor 3"],
  ["LAZY SUSAN 4", "Lazy Susan Conveyor 4"],
  ["LAZY SUSAN 5", "Lazy Susan Conveyor 5"],
  ["LAZY SUSAN 6", "Lazy Susan Conveyor 6"],
  ["LAZY SUSAN 7", "Lazy Susan Conveyor 7"],
  ["LINK CUTTER", "Link Cutter Machine"],
  ["LOG SPLITTER", "Log Splitter"],
  ["MARINE", "Marine Machineries"],
  ["METAL DETECTOR", "Metal Detector Loma 1"],
  ["METAL DETECTOR 2", "Metal Detector Loma 2"],
  ["METAL DETECTOR 3", "Metal Detector Now System 3"],
  ["METAL DETECTOR 4", "Metal Detector Loma 4"],
  ["METAL DETECTOR 5", "Metal Detector Baoji- 5 ( Siomai )"],
  ["MINI BOILER", "Vertical Type Boiler"],
  ["MIXER", "Seydelmann Mixer 1"],
  ["MIXER 2", "Seydelmann Mixer 2"],
  ["MIXER 3", "Seydelmann Mixer 3"],
  ["NONE", "None"],
  ["R.O.", "Reverse Osmosis 1"],
  ["R.O. 2", "Reverse Osmosis 2"],
  ["RETORT", "Retort Vessel 1"],
  ["RETORT 2", "Retort Vessel 2"],
  ["RETORT 3", "Retort Vessel 3"],
  ["RETORT 4", "Retort Vessel 4"],
  ["RETORT 5", "Retort Vessel 5"],
  ["RETORT 6", "Retort Vessel 6"],
  ["RETORT 7", "Retort Vessel 7"],
  ["RETORT 8", "Retort Vessel 8"],
  ["RETORT 9", "Retort Vessel 9"],
  ["RIBBON MIXER", "Ribbo Mixer siomai"],
  ["SEALER", "Vacuum Sealer"],
  ["SEAMER", "Seamer Machines"],
  ["SIOMAI FORMER", "Siomai Machine 1"],
  ["SIOMAI FORMER 0", "Imported Machine 3 layer Siomai Former"],
  ["SIOMAI FORMER 2", "Siomai Machine 2"],
  ["SIOMAI FORMER 3", "Siomai Machine 3"],
  ["SIOMAI FORMER 4", "Siomai Machine 4"],
  ["SIOMAI FORMER 5", "Siomai Machine 5"],
  ["SIOMAI FORMER 6", "Siomai Machine 6"],
  ["SIOMAI FORMER 7", "Siomai Machine 7"],
  ["SIOMAI STEAMER", "Steamer Cabinet 1"],
  ["SIOMAI STEAMER 2", "Steamer Cabinet 2"],
  ["SIOMAI STEAMER 3", "Steamer Cabinet 3"],
  ["SMOKEHOUSE", "Smokehouse"],
  ["SORTING CONVEYOR", "Sorting Conveyor"],
  ["STUFFING", "Stuffing Machine"],
  ["TRAY", "Siomai Tray"],
  ["TROLLEYS/CART", "Trolleys & Cart"],
  ["WALK IN CHILLER", "Walk In Chiller"],
  ["WATER TANK OLD", "Water Tank Old"],
  ["WATER TANK PROJECT", "Water Tank"],
  ["WEIGHING SCALE", "Table Top Weighing Scale"],
  ["WOOD CHIPPER", "Wood Chipper"],
  ["WWTP", "Waste Water"],
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const now = new Date().toISOString();
    let inserted = 0;
    let backfilled = 0;

    for (const [code, description] of MACHINE_CODES) {
      const value = code.toUpperCase();

      const insertResult = await pool.query(
        `INSERT INTO option_lists (kind, value, description, created_at)
         SELECT 'machine_code', $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM option_lists WHERE kind = 'machine_code' AND upper(value) = upper($1)
         )`,
        [value, description, now]
      );
      if ((insertResult.rowCount ?? 0) > 0) {
        inserted += 1;
        continue;
      }

      // Already present from earlier free-typed usage (no description) —
      // backfill the description without touching the value.
      const backfillResult = await pool.query(
        `UPDATE option_lists SET description = $2
         WHERE kind = 'machine_code' AND upper(value) = upper($1) AND description IS NULL`,
        [value, description]
      );
      backfilled += backfillResult.rowCount ?? 0;
    }

    console.log(`OK: machine_code seed (${inserted} inserted, ${backfilled} backfilled, ${MACHINE_CODES.length - inserted - backfilled} already up to date)`);
    console.log("\nMachine code migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
