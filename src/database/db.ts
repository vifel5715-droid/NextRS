import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";
import { logger } from "../core/logger/logger.js";

const connectionString = env.DATABASE_URL;
// Log a masked version for debugging (avoid printing full password)
try {
  const url = new URL(connectionString);
  const maskedAuth = url.username ? `${url.username}:*****@` : '';
  const masked = `postgres://${maskedAuth}${url.host}${url.pathname}`;
  console.log('Using DB connection:', masked);
} catch (_) {
  console.log('Using DB connection string (masked)');
}
const pool = new Pool({ connectionString });

// pg's Pool emits 'error' on an idle client failure (dropped connection,
// server-side terminate, etc.). With no listener, Node treats that as an
// uncaught exception and kills the whole process — one bad connection takes
// down every in-flight request, not just the one that owned it.
pool.on("error", (err) => {
  logger.error("Unexpected error on idle database client:", err);
});

export const db = drizzle(pool, { schema });
