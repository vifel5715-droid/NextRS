import "server-only";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globalPools = globalThis as typeof globalThis & { requestSystemPgPool?: Pool };

function getPool(): Pool {
  if (globalPools.requestSystemPgPool) return globalPools.requestSystemPgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required by the Next.js server.");
  }

  const pool = new Pool({ connectionString });
  pool.on("error", (error) => {
    console.error("Unexpected error on an idle PostgreSQL client:", error);
  });
  globalPools.requestSystemPgPool = pool;
  return pool;
}

export const getDb = () => drizzle(getPool(), { schema });
