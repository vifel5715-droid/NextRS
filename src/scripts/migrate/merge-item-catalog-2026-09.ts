import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { env } from "../../config/env.js";

interface CatalogRow {
  item_name: string;
  uom: string;
  approval_level: "MANAGER_ONLY" | "SUPERVISOR_OR_MANAGER";
  departments: string | null;
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(
  readFileSync(path.join(directory, "data/item-catalog-2026-09.json"), "utf-8")
) as CatalogRow[];

async function main(): Promise<void> {
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        typeof row.item_name !== "string" ||
        typeof row.uom !== "string" ||
        !["MANAGER_ONLY", "SUPERVISOR_OR_MANAGER"].includes(row.approval_level) ||
        (row.departments !== null && typeof row.departments !== "string")
    )
  ) {
    throw new Error("The September 2026 item catalog file contains invalid rows.");
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
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
           SELECT 1
           FROM item_catalog existing
           WHERE upper(existing.item_name) = upper(source.item_name)
             AND upper(coalesce(existing.uom, '')) = upper(coalesce(source.uom, ''))
         )`,
      [JSON.stringify(rows), new Date().toISOString()]
    );
    await client.query("COMMIT");
    console.log(`Added ${result.rowCount ?? 0} missing catalog items; existing catalog rows were left unchanged.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Item catalog merge failed:", error);
  process.exitCode = 1;
});
