import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { env } from "../config/env.js";
import { TABLE_STATEMENTS } from "../database/tables.js";

const MIGRATIONS = [
  "migrate:rename-username",
  "migrate:add-roles",
  "migrate:add-deletion-log",
  "migrate:add-adjustment-log",
  "migrate:add-item-catalog",
  "migrate:add-urgent-requests",
  "migrate:add-urgent-request-supervisor-review",
  "migrate:add-payment-request-form",
  "migrate:add-urgent-request-item-uom",
  "migrate:add-urgent-request-date-needed",
  "migrate:add-urgent-request-item-delivery",
  "migrate:add-item-payment-request-form",
  "migrate:add-reimbursement-requests",
  "migrate:add-reimbursement-closed-columns",
  "migrate:add-petty-cash",
  "migrate:add-petty-cash-serial",
  "migrate:add-columns",
  "migrate:merge-item-catalog-2026-09",
  "migrate:add-option-lists",
  "migrate:add-machine-codes",
  "migrate:add-departments",
  "migrate:add-item-groups",
  "migrate:rename-payment-request-to-urgent",
  "migrate:backfill-service-status",
  "migrate:add-fk",
] as const;

function isLocalDatabase(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function getMigrationDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!isLocalDatabase(databaseUrl)) {
    // Railway Postgres may present a self-signed certificate; match init-db's TLS behavior.
    url.searchParams.set("sslmode", "no-verify");
  }
  return url.toString();
}

function requireProductionSeedPassword(): void {
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
  if (isProduction && !env.INIT_DB_DEMO_PASSWORD?.trim()) {
    throw new Error(
      "Set INIT_DB_DEMO_PASSWORD to a strong initial admin password before running database setup in production."
    );
  }
}

function runNpmScript(script: string, npmExecPath: string, childEnv: NodeJS.ProcessEnv): void {
  console.log(`\n>>> npm run ${script}`);
  const result = spawnSync(process.execPath, [npmExecPath, "run", script], {
    stdio: "inherit",
    env: childEnv,
  });

  if (result.error) {
    throw new Error(`Could not start "${script}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    const exit = result.status === null ? `terminated by ${result.signal ?? "a signal"}` : `exited with code ${result.status}`;
    throw new Error(`Database setup stopped: "${script}" ${exit}.`);
  }
}

async function setupDatabase(): Promise<void> {
  requireProductionSeedPassword();

  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error("Run database setup with `npm run db:setup`.");
  }

  const databaseUrl = env.DATABASE_URL;
  const local = isLocalDatabase(databaseUrl);
  const migrationDatabaseUrl = getMigrationDatabaseUrl(databaseUrl);
  const childEnv = { ...process.env, DATABASE_URL: migrationDatabaseUrl };
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: local ? false : { rejectUnauthorized: false },
  });

  try {
    console.log("Creating any missing tables from the current schema...");
    for (const table of TABLE_STATEMENTS) {
      await pool.query(table.sql);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS nextjs_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of MIGRATIONS) {
      const { rows } = await pool.query(
        "SELECT 1 FROM nextjs_schema_migrations WHERE name = $1",
        [migration]
      );
      if (rows.length > 0) {
        console.log(`\n>>> SKIP ${migration} (already recorded)`);
        continue;
      }

      runNpmScript(migration, npmExecPath, childEnv);
      await pool.query(
        "INSERT INTO nextjs_schema_migrations (name) VALUES ($1)",
        [migration]
      );
    }

    runNpmScript("init-db", npmExecPath, childEnv);
    console.log(
      "\nDatabase setup completed. Destructive catalog replacement, legacy upload migration, and permission-reset scripts were not run."
    );
  } finally {
    await pool.end();
  }
}

setupDatabase().catch((error: unknown) => {
  console.error("Database setup failed:", error);
  process.exitCode = 1;
});
