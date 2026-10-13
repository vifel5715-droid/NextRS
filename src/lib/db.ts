import "server-only";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";

const globalPools = globalThis as typeof globalThis & { requestSystemPgPool?: Pool };

function getPool(): Pool {
  if (globalPools.requestSystemPgPool) return globalPools.requestSystemPgPool;

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  pool.on("error", (error) => {
    logger.error("Unexpected error on an idle PostgreSQL client", { error });
  });
  globalPools.requestSystemPgPool = pool;
  return pool;
}

export const getDb = () => drizzle(getPool(), { schema });
