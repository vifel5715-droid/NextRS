import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { env } from "../src/lib/env";
import { seedBuiltInRoles } from "../src/db/seed-roles";
import { initializeDatabaseSchema } from "../src/db/bootstrap";
import { seedReferenceData } from "../src/db/seed-data";
import { hashPassword } from "../src/lib/password";

const DEFAULT_USERS = [
  { name: "JOEL", username: "joel", role: "staff", department: "HR" },
  { name: "MYRNA", username: "myrna", role: "supervisor", department: "HR" },
  { name: "ROB", username: "rob", role: "manager", department: "HR" },
  { name: "MARQUEZ, PETER PAUL", username: "paul", role: "custodian", department: "ACCTG" },
  { name: "GABRIEL", username: "gabriel", role: "director", department: "ACCTG" },
  { name: "ADMIN", username: "admin", role: "admin", department: "ACCTG" },
] as const;

function isLocalDatabase(databaseUrl: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname);
}

function requireProductionSeedPassword(): void {
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
  if (isProduction && !env.INIT_DB_DEMO_PASSWORD?.trim()) {
    throw new Error(
      "Set INIT_DB_DEMO_PASSWORD to a strong initial admin password before initializing the production database."
    );
  }
}

async function seedDefaultUsers(pool: Pool): Promise<void> {
  const configuredPassword = env.INIT_DB_DEMO_PASSWORD;
  const now = new Date().toISOString();
  const createdUsers: Array<{ username: string; role: string; department: string; password: string }> = [];

  for (const user of DEFAULT_USERS) {
    const password = configuredPassword || randomBytes(6).toString("base64url");
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (name, username, password_hash, role, department, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO NOTHING
       RETURNING username`,
      [user.name, user.username, passwordHash, user.role, user.department, now]
    );
    if (result.rowCount) {
      createdUsers.push({ username: user.username, role: user.role, department: user.department, password });
    }
  }

  if (createdUsers.length) {
    console.log("New default accounts:");
    for (const user of createdUsers) {
      const passwordNote = configuredPassword
        ? "password set via INIT_DB_DEMO_PASSWORD"
        : `password: ${user.password}`;
      console.log(`  ${user.role}: ${user.username} — ${passwordNote} (${user.department})`);
    }
  } else {
    console.log("Default accounts already exist; existing passwords were left unchanged.");
  }
}

async function main(): Promise<void> {
  requireProductionSeedPassword();

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: isLocalDatabase(env.DATABASE_URL) ? false : { rejectUnauthorized: false },
  });

  try {
    console.log("Creating/updating the current database schema...");
    await initializeDatabaseSchema(pool);

    console.log("\nSeeding built-in roles and permissions...");
    await seedBuiltInRoles(pool);

    console.log("\nImporting reference data...");
    await seedReferenceData(pool);

    console.log("\nSeeding default accounts...");
    await seedDefaultUsers(pool);

    console.log("\nDatabase initialization completed successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Database initialization failed:", error);
  process.exitCode = 1;
});
