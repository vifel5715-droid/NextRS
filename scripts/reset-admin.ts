/**
 * ARCH: Maintenance script (run via `npm run reset-admin`).
 * Resets the admin account to a known password.
 *
 * Bug fix: the original targeted `admin1@stp.com`, which never matched the
 * account seeded by `init-db.ts` (`admin@stps.com`), so the reset was a no-op.
 * Aligned to the canonical seed email here.
 *
 * SECURITY: no hardcoded password. Set ADMIN_RESET_PASSWORD to choose one
 * explicitly, or omit it to have the script generate a random one-time
 * password — printed once here since that's the only place it's ever
 * visible (only its argon2 hash is stored).
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { env } from "../src/lib/env";
import { hashPassword } from "../src/lib/password";

const ADMIN_EMAIL = "admin@stps.com";

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const providedPassword = process.env.ADMIN_RESET_PASSWORD;
    const password = providedPassword || randomBytes(9).toString("base64url");

    console.log(`Resetting admin account (${ADMIN_EMAIL})...`);

    await pool.query("DELETE FROM users WHERE username = $1", [ADMIN_EMAIL]);
    console.log("Deleted existing admin account");

    const passwordHash = await hashPassword(password);
    await pool.query(
      `INSERT INTO users (name, username, password_hash, role, department, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["Admin User", ADMIN_EMAIL, passwordHash, "admin", "ACCTG", new Date().toISOString()]
    );

    console.log("Created new admin account");
    console.log(`Email: ${ADMIN_EMAIL}`);
    if (providedPassword) {
      console.log("Password: set from ADMIN_RESET_PASSWORD (not re-printed here)");
    } else {
      console.log(`Temporary password (shown once, not stored anywhere else): ${password}`);
      console.log("Set ADMIN_RESET_PASSWORD instead if you want to choose the password yourself.");
    }
  } catch (error) {
    console.error("Error resetting admin:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
