/**
 * ARCH: One-off bootstrap script (run via `npm run init-db`).
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { env } from "../config/env.js";
import { hashPassword } from "../shared/utils/password.js";
import { INDEX_STATEMENTS } from "../database/indexes.js";
import { TABLE_STATEMENTS } from "../database/tables.js";
import { seedBuiltInRoles } from "../database/seedRoles.js";

async function main() {
  console.log("Creating database tables...");

  // Added SSL options so Railway Postgres connections do not throw ErrorEvent
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL?.includes("localhost") || env.DATABASE_URL?.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    for (const table of TABLE_STATEMENTS) {
      await pool.query(table.sql);
    }
    console.log(`Created ${TABLE_STATEMENTS.length} tables (or already present)`);

    for (const index of INDEX_STATEMENTS) {
      await pool.query(index.sql);
    }
    console.log(`Created ${INDEX_STATEMENTS.length} indexes (or already present)`);

    console.log("\nSeeding built-in roles and permissions...");
    await seedBuiltInRoles(pool);

    const departments = [
      { code: "ACCTG", name: "Accounting" },
      { code: "HR", name: "Human Resources" },
      { code: "QA", name: "Quality Assurance" },
      { code: "ENGG", name: "Engineering" },
      { code: "PRODNCAN", name: "Production Canning" },
      { code: "PRODSIO", name: "Production Siomai" },
      { code: "PRODNMAR", name: "Production Marine" },
      { code: "PRODNHOT", name: "Production Hotdog" },
    ];

    for (const dept of departments) {
      await pool.query(
        `INSERT INTO departments (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [dept.code, dept.name]
      );
    }

    const demoPassword = process.env.INIT_DB_DEMO_PASSWORD;
    const defaultUsers = [
      { name: "JOEL", email: "joel", role: "staff", department: "HR" },
      { name: "MYRNA", email: "myrna", role: "supervisor", department: "HR" },
      { name: "ROB", email: "rob", role: "manager", department: "HR" },
      { name: "MARQUEZ, PETER PAUL", email: "paul", role: "custodian", department: "ACCTG" },
      { name: "GABRIEL", email: "gabriel", role: "director", department: "ACCTG" },
      { name: "ADMIN", email: "admin", role: "admin", department: "ACCTG" },
    ].map((user) => ({ ...user, password: demoPassword || randomBytes(6).toString("base64url") }));

    for (const user of defaultUsers) {
      const passwordHash = await hashPassword(user.password);
      await pool.query(
        `INSERT INTO users (name, username, password_hash, role, department, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (username) DO NOTHING`,
        [user.name, user.email, passwordHash, user.role, user.department, new Date().toISOString()]
      );
    }

    console.log("Default users created (existing accounts left untouched):");
    for (const user of defaultUsers) {
      const passwordNote = demoPassword ? "password set via INIT_DB_DEMO_PASSWORD" : `password: ${user.password}`;
      console.log(`  ${user.role}: ${user.email} — ${passwordNote} (${user.department})`);
    }

    console.log("Database tables created successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error creating tables:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();