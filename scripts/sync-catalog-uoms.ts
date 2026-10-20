/**
 * One-time correction for IRS lines saved with a UoM that differs from their
 * Item List entry (before the server enforced the catalog UoM).
 *
 *   npm run sync:catalog-uoms                     # dry run: lists what would change
 *   npm run sync:catalog-uoms -- --apply --by=<username>
 *
 * Only touches lines with no delivery status and nothing delivered or
 * released yet — anything already purchased/issued keeps the UoM it was
 * transacted in. Every change is written to Adjustment History under --by.
 */
import { Pool } from "pg";
import { env } from "../src/lib/env";
import { catalogUomLookup, type CatalogUomRow } from "../src/lib/utils/catalogUom";
import { nextSerial } from "../src/server/services/serial-numbers";

const apply = process.argv.includes("--apply");
const byUsername = process.argv.find((arg) => arg.startsWith("--by="))?.slice("--by=".length);

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const catalog = (await client.query<CatalogUomRow>("SELECT item_name, uom, departments FROM item_catalog")).rows;
    const lines = (
      await client.query<{ id: number; request_id: number; serial: string; department: string; item_name: string; uom: string }>(
        `SELECT i.id, i.request_id, r.serial, r.department, i.item_name, i.uom
           FROM item_request_items i JOIN item_requests r ON r.id = i.request_id
          WHERE i.delivery_status IS NULL
            AND COALESCE(i.quantity_delivered, 0) = 0
            AND COALESCE(i.quantity_out, 0) = 0
          ORDER BY r.serial, i.id`
      )
    ).rows;

    const lookups = new Map<string, (name: string) => string | undefined>();
    const changes = lines.flatMap((line) => {
      const lookup = lookups.get(line.department) ?? catalogUomLookup(catalog, line.department);
      lookups.set(line.department, lookup);
      const uom = lookup(line.item_name);
      return uom && uom !== line.uom ? [{ ...line, next: uom }] : [];
    });

    if (changes.length === 0) {
      console.log("No IRS lines need a UoM correction.");
      return;
    }
    console.table(changes.map((c) => ({ serial: c.serial, item: c.item_name, current: c.uom, "item list": c.next })));
    if (!apply) {
      console.log(`Dry run — ${changes.length} line(s) would change. Re-run with --apply --by=<username> to write.`);
      return;
    }

    if (!byUsername) throw new Error("--apply needs --by=<username> to record who made the correction.");
    const user = (await client.query("SELECT id, name, role, department FROM users WHERE username = $1", [byUsername])).rows[0];
    if (!user) throw new Error(`No user named "${byUsername}".`);

    await client.query("BEGIN");
    const year = new Date().getFullYear();
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`adjustment-serial-${year}`]);
    const existing = (
      await client.query<{ adjustment_serial: string }>("SELECT adjustment_serial FROM adjustment_log WHERE adjustment_serial LIKE $1", [`ADJ-${year}-%`])
    ).rows.map((row) => row.adjustment_serial);
    const adjustmentSerial = nextSerial(`ADJ-${year}-`, existing);
    const now = new Date().toISOString();

    for (const change of changes) {
      await client.query("UPDATE item_request_items SET uom = $1 WHERE id = $2", [change.next, change.id]);
      await client.query(
        `INSERT INTO adjustment_log (adjustment_serial, request_id, request_type, request_serial, department, item_label, field,
           before_value, after_value, adjustment_remarks, adjusted_by, adjusted_by_name, adjusted_by_role, adjusted_by_department, adjusted_at)
         VALUES ($1, $2, 'item', $3, $4, $5, 'UoM', $6, $7, 'UoM corrected to match Item List', $8, $9, $10, $11, $12)`,
        [adjustmentSerial, change.request_id, change.serial, change.department, change.item_name, change.uom, change.next,
         user.id, user.name, user.role, user.department, now]
      );
    }
    await client.query("COMMIT");
    console.log(`Updated ${changes.length} line(s) under ${adjustmentSerial}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
