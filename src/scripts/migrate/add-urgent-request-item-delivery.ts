/**
 * ARCH: Idempotent column migration (run via
 * `npm run migrate:add-urgent-request-item-delivery`).
 * Adds delivery self-attestation fields to urgent_request_items — for Not
 * Inventoriable items only (they skip Custodian/inventory tracking
 * entirely), so the requesting department confirms receipt themselves. New
 * installs already get these via `npm run init-db` (database/tables.ts,
 * shared here).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const MIGRATIONS: Array<{ label: string; sql: string }> = [
  { label: "urgent_request_items.delivery_status", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending'" },
  { label: "urgent_request_items.quantity_delivered", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS quantity_delivered INTEGER" },
  { label: "urgent_request_items.delivered_by", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS delivered_by UUID" },
  { label: "urgent_request_items.delivered_at", sql: "ALTER TABLE urgent_request_items ADD COLUMN IF NOT EXISTS delivered_at TEXT" },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const { label, sql } of MIGRATIONS) {
      await pool.query(sql);
      console.log(`OK: ${label}`);
    }

    console.log("\nUrgent request item delivery migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
