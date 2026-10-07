/**
 * ARCH: One-off column rename (run via `npm run migrate:rename-username`).
 * Renames users.email -> users.username to match the schema.ts field
 * introduced when the login/user-management UI switched from an
 * email-only field to a general username. Idempotent: skips if the
 * rename already happened.
 */
import { Pool } from "pg";
import { env } from "../../config/env.js";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('email', 'username')
    `);
    const hasEmail = rows.some((r) => r.column_name === "email");
    const hasUsername = rows.some((r) => r.column_name === "username");

    if (hasUsername) {
      console.log("users.username already exists — nothing to do.");
    } else if (hasEmail) {
      await pool.query(`ALTER TABLE users RENAME COLUMN email TO username`);
      console.log("Renamed users.email -> users.username");
    } else {
      throw new Error("Neither users.email nor users.username found — unexpected schema state.");
    }
    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
