/**
 * ARCH: Idempotent FK-constraint backfill (run via `npm run migrate:add-fk`).
 * init-db.ts creates item_request_items/service_items/item_status/service_status
 * with a bare `request_id INTEGER` column and no REFERENCES clause, so existing
 * databases bootstrapped before this migration have no referential integrity
 * between those child rows and their parent request. This adds the missing
 * FOREIGN KEY constraints (ON DELETE CASCADE, matching the manual delete order
 * already used by clear-requests.ts) without touching data.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

const CONSTRAINTS: Array<{ label: string; table: string; name: string; sql: string }> = [
  {
    label: "item_request_items.request_id -> item_requests.id",
    table: "item_request_items",
    name: "fk_item_request",
    sql: `ALTER TABLE item_request_items
          ADD CONSTRAINT fk_item_request
          FOREIGN KEY (request_id) REFERENCES item_requests(id) ON DELETE CASCADE`,
  },
  {
    label: "service_items.service_request_id -> service_requests.id",
    table: "service_items",
    name: "fk_service_request",
    sql: `ALTER TABLE service_items
          ADD CONSTRAINT fk_service_request
          FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE CASCADE`,
  },
  {
    label: "item_status.request_id -> item_requests.id",
    table: "item_status",
    name: "fk_item_status_request",
    sql: `ALTER TABLE item_status
          ADD CONSTRAINT fk_item_status_request
          FOREIGN KEY (request_id) REFERENCES item_requests(id) ON DELETE CASCADE`,
  },
  {
    label: "service_status.request_id -> service_requests.id",
    table: "service_status",
    name: "fk_service_status_request",
    sql: `ALTER TABLE service_status
          ADD CONSTRAINT fk_service_status_request
          FOREIGN KEY (request_id) REFERENCES service_requests(id) ON DELETE CASCADE`,
  },
];

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const c of CONSTRAINTS) {
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE table_name = $1 AND constraint_name = $2`,
        [c.table, c.name]
      );
      if (rows.length > 0) {
        console.log(`SKIP: ${c.label} (already present)`);
        continue;
      }
      await pool.query(c.sql);
      console.log(`OK: ${c.label}`);
    }
    console.log("\nFK constraint migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
