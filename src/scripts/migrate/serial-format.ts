/**
 * ARCH: One-off data migration (run via `npm run migrate:serial-format`).
 * Rewrites legacy serials to the current IRS-00-YYYY-NNNNNN / SRS-00-YYYY-NNNNNN format.
 * Idempotent: only touches rows still using the legacy prefix or old numbering style.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const normalizeLegacySerial = (serial: string, targetPrefix: "IRS" | "SRS") => {
 const normalized = serial
   .replace(/[:\s]+/g, "-")
   .replace(/-+/g, "-")
   .replace(/^-|-$/g, "");

 if (/^(IRS|SRS)-00-\d{4}-\d{6}$/.test(normalized)) {
   return normalized;
 }

 const match = normalized.match(/^(IR|SR|IRS|SRS)-?(\d{4})-(\d+)$/i);
 if (!match) {
   return serial;
 }

 const [, , year, sequence] = match;
 const numericValue = Number.parseInt(sequence, 10) || 0;
 return `${targetPrefix}-00-${year}-${String(numericValue).padStart(6, "0")}`;
};

async function main() {
 const pool = new Pool({ connectionString: env.DATABASE_URL });
 try {
   console.log("Starting serial-number migration...\n");

   console.log("Item Requests (legacy -> IRS-00-YYYY-NNNNNN)...");
   const itemRows = await pool.query(`SELECT id, serial FROM item_requests WHERE serial LIKE 'IR-%' OR serial LIKE 'IRS-%' ORDER BY id`);
   for (const row of itemRows.rows) {
     const nextSerial = normalizeLegacySerial(row.serial, "IRS");
     if (nextSerial !== row.serial) {
       await pool.query("UPDATE item_requests SET serial = $1 WHERE id = $2", [nextSerial, row.id]);
     }
   }
   const itemCount = await pool.query(`SELECT COUNT(*) AS count FROM item_requests WHERE serial LIKE 'IRS-%'`);
   console.log(`Item Requests now using IRS- prefix: ${itemCount.rows[0].count}`);

   console.log("\nService Requests (legacy -> SRS-00-YYYY-NNNNNN)...");
   const serviceRows = await pool.query(`SELECT id, serial FROM service_requests WHERE serial LIKE 'SR-%' OR serial LIKE 'SRS-%' ORDER BY id`);
   for (const row of serviceRows.rows) {
     const nextSerial = normalizeLegacySerial(row.serial, "SRS");
     if (nextSerial !== row.serial) {
       await pool.query("UPDATE service_requests SET serial = $1 WHERE id = $2", [nextSerial, row.id]);
     }
   }
   const serviceCount = await pool.query(`SELECT COUNT(*) AS count FROM service_requests WHERE serial LIKE 'SRS-%'`);
   console.log(`Service Requests now using SRS- prefix: ${serviceCount.rows[0].count}`);

   console.log("\nMigration complete.");
 } catch (error) {
   console.error("Migration failed:", error);
   process.exit(1);
 } finally {
   await pool.end();
 }
}

main().catch(console.error);
