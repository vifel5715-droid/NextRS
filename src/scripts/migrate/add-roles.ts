/**
 * ARCH: Idempotent table + index creation (run via `npm run migrate:add-roles`),
 * plus a one-time seed of the built-in roles and their page-permission
 * grants — for an existing install that predates the roles/role_permissions
 * tables or a newer permission key. New installs get both the tables and the
 * seed via `npm run init-db` (database/seedRoles.ts's seedBuiltInRoles is
 * shared by both, so they can't drift apart).
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";
import { TABLE_STATEMENTS } from "../../database/tables.js";
import { INDEX_STATEMENTS } from "../../database/indexes.js";
import { seedBuiltInRoles } from "../../database/seedRoles.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    for (const tableLabel of ["roles", "role_permissions"]) {
      const table = TABLE_STATEMENTS.find((t) => t.label === tableLabel);
      if (table) {
        await pool.query(table.sql);
        console.log(`OK: ${table.label} table (created or already present)`);
      }
    }

    const indexes = INDEX_STATEMENTS.filter(
      (i) => i.label.startsWith("roles.") || i.label.startsWith("role_permissions.")
    );
    for (const index of indexes) {
      await pool.query(index.sql);
      console.log(`OK: ${index.label} (created or already present)`);
    }

    await seedBuiltInRoles(pool);

    console.log("\nRoles migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
